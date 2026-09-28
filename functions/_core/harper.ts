/**
 * Harper grammar engine for the Functions runtime.
 *
 * Harper's ~16 MB WebAssembly binary cannot be bundled, so it is loaded at
 * runtime from a URL: the WASM ships as a static asset of the site
 * (`/assets/harper_wasm_bg.wasm`), derived from the incoming request's origin
 * or the `WASM_BASE_URL` env var.
 *
 * Only the harper.js *JavaScript glue* is bundled (vendored in
 * `functions/_vendor/harper/`, ~250 KB — verified to contain no static WASM
 * references). The WASM itself is fetched lazily on first use and the
 * initialized linter is cached at module scope across requests.
 *
 * Privacy: submitted text is processed in memory only, never persisted or logged.
 */

import {
  grammarFailure,
  normalizeLints,
  resolveOptions,
  validateCheckRequest,
  type GrammarResult,
  type RawLint,
  type ResolvedCheckOptions,
} from "./grammar";

export const HARPER_WASM_PATH = "/assets/harper_wasm_bg.wasm";

/** Resolve the WASM URL: explicit env override, else the request origin. */
export function resolveWasmUrl(request: Request, wasmBaseUrl?: string): string {
  const base = (wasmBaseUrl ?? "").trim();
  if (base) {
    if (/\.wasm(\?|#|$)/i.test(base)) return base;
    return base.replace(/\/+$/, "") + HARPER_WASM_PATH;
  }
  return new URL(request.url).origin + HARPER_WASM_PATH;
}

interface HarperSpan {
  start: number;
  end: number;
}

interface HarperSuggestion {
  kind(): number;
  get_replacement_text(): string;
}

interface HarperLint {
  lint_kind(): string;
  message(): string;
  span(): HarperSpan;
  suggestions(): HarperSuggestion[];
}

interface HarperLinter {
  setup(): Promise<void>;
  organizedLints(text: string, options?: Record<string, unknown>): Promise<Record<string, HarperLint[]>>;
}

/** SuggestionKind.Replace — the only kind that can be auto-applied. */
const REPLACE_KIND = 0;

interface CachedLinter {
  url: string;
  promise: Promise<HarperLinter>;
}

let cached: CachedLinter | null = null;

async function loadLinter(wasmUrl: string): Promise<HarperLinter> {
  // Dynamic import of the vendored JS glue (typed via the sibling index.d.ts).
  // The bundler resolves this to the local files; the WASM binary itself is
  // fetched at runtime from wasmUrl.
  const harper = await import("../_vendor/harper/index.js");
  const binary = harper.createBinaryModuleFromUrl(wasmUrl, "full");
  const linter = new harper.LocalLinter({ binary });
  await linter.setup();
  return linter as unknown as HarperLinter;
}

function getLinter(wasmUrl: string): Promise<HarperLinter> {
  if (!cached || cached.url !== wasmUrl) {
    const entry: CachedLinter = { url: wasmUrl, promise: loadLinter(wasmUrl) };
    // Drop failed loads so the next request retries instead of caching rejection.
    entry.promise.catch(() => {
      if (cached === entry) cached = null;
    });
    cached = entry;
  }
  return cached.promise;
}

/** For tests: clear the module-scope linter cache. */
export function __resetLinterCache(): void {
  cached = null;
}

function toRawLints(organized: Record<string, HarperLint[]>): RawLint[] {
  const raw: RawLint[] = [];
  for (const [ruleId, lints] of Object.entries(organized)) {
    for (const lint of lints) {
      const span = lint.span();
      const replacements: string[] = [];
      for (const suggestion of lint.suggestions()) {
        if (suggestion.kind() !== REPLACE_KIND) continue;
        const replacement = suggestion.get_replacement_text();
        if (typeof replacement === "string") replacements.push(replacement);
      }
      raw.push({
        rule_id: ruleId || null,
        kind: lint.lint_kind(),
        message: lint.message(),
        start: span.start,
        end: span.end,
        replacements,
      });
    }
  }
  return raw;
}

export interface CheckTextOptions {
  /** Incoming request (used to derive the WASM URL from the origin). */
  request: Request;
  /** Env override for the WASM base URL. Optional. */
  wasmBaseUrl?: string;
  /** Maximum characters accepted. */
  maxChars: number;
  /** Hard ceiling for the check, in milliseconds. */
  timeoutMs: number;
  includeSuggestions?: boolean;
  includeRuleIds?: boolean;
}

/**
 * Runs Harper over the text and returns the normalized grammar result.
 * Returns a GrammarFailure (never throws) for invalid input, timeouts, and
 * engine errors. Raw engine errors are reduced to a fixed code at the
 * boundary: they can quote the document and must never surface or be logged.
 */
export async function checkText(text: string, options: CheckTextOptions): Promise<GrammarResult> {
  const invalid = validateCheckRequest({ text, language: "en", maxChars: options.maxChars });
  if (invalid) return invalid;

  const resolved: ResolvedCheckOptions = resolveOptions({
    include_suggestions: options.includeSuggestions,
    include_rule_ids: options.includeRuleIds,
  });
  const wasmUrl = resolveWasmUrl(options.request, options.wasmBaseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();

  try {
    const linter = await getLinter(wasmUrl);
    const organized = await Promise.race([
      linter.organizedLints(text, { language: "plaintext" }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("check timed out")), {
          once: true,
        });
      }),
    ]);
    return await normalizeLints(text, toRawLints(organized), resolved, Date.now() - startedAt);
  } catch (e) {
    if (controller.signal.aborted) {
      return grammarFailure("timeout", "The grammar check took too long and was cancelled.");
    }
    // SpaceFast preview: the edge runtime disallows WebAssembly compilation,
    // so the Harper engine cannot run server-side. Fall back to the pure-JS
    // checker (focused high-precision rules). The browser editor at /editor
    // runs the full Harper engine locally.
    const msg = String(e ?? "");
    if (/disallowed by embedder|WebAssembly/i.test(msg)) {
      const { checkTextJs } = await import("./js-checker");
      const jsLints = checkTextJs(text, options.maxChars);
      // Convert JsRawLint[] to RawLint[] and normalize.
      const rawLints: RawLint[] = jsLints.map((l) => ({
        rule_id: l.rule_id,
        kind: l.category,
        message: l.message,
        start: l.start,
        end: l.end,
        replacements: l.suggestions,
      }));
      return await normalizeLints(text, rawLints, resolved, Date.now() - startedAt);
    }
    return grammarFailure("internal", "The grammar engine could not complete this check.");
  } finally {
    clearTimeout(timer);
  }
}

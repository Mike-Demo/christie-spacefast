/**
 * The single normalized grammar-checking contract.
 *
 * Ported from `src/lib/grammar/contract.ts`, `normalize.ts`, and `validate.ts`
 * (pure functions only — no imports from src/). Both front doors — the
 * in-browser editor and the remote MCP tool — produce and consume exactly
 * these shapes.
 *
 * Privacy: `original_text` is returned to the caller in the response only. It
 * is never persisted and never logged.
 */

export const CONTRACT_VERSION = "1" as const;

/** The only language this service supports. */
export const SUPPORTED_LANGUAGE = "en" as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGE;

export type GrammarErrorCode =
  | "invalid_input"
  | "unsupported_language"
  | "too_large"
  | "rate_limited"
  | "unauthorized"
  | "timeout"
  | "internal";

export interface Issue {
  /** Stable within a response: first 12 hex chars of sha-256(`rule_id:start:end`). */
  id: string;
  /** Harper's originating rule name, or null when unavailable or not requested. */
  rule_id: string | null;
  /** Harper lint kind, lower-cased. "other" when Harper reports none. */
  category: string;
  /** Plain-language description of the problem. */
  message: string;
  /** Inclusive start offset, in UTF-16 code units. */
  start: number;
  /** Exclusive end offset, in UTF-16 code units. */
  end: number;
  /** The offending slice of the submitted text. Returned only, never stored. */
  original_text: string;
  /** Replacement candidates. Empty when none, or when suggestions were not requested. */
  suggestions: string[];
  /** True only when exactly one replacement suggestion exists (safe to auto-apply). */
  safe: boolean;
}

export interface GrammarSuccess {
  contract_version: typeof CONTRACT_VERSION;
  success: true;
  language: SupportedLanguage;
  /** Length of the submitted text in UTF-16 code units — same unit as start/end. */
  document_length: number;
  /** Always equal to issues.length. */
  issue_count: number;
  /** Sorted by start, then end, then rule_id. */
  issues: Issue[];
  /** Whole-request processing time in whole milliseconds. */
  processing_ms: number;
}

export interface GrammarFailure {
  contract_version: typeof CONTRACT_VERSION;
  success: false;
  error: {
    code: GrammarErrorCode;
    message: string;
    /** Seconds the caller should wait before retrying, or null when not applicable. */
    retry_after_s: number | null;
  };
}

export type GrammarResult = GrammarSuccess | GrammarFailure;

export interface CheckGrammarOptions {
  language?: string;
  include_suggestions?: boolean;
  include_rule_ids?: boolean;
}

/** Normalized options with every default resolved. */
export interface ResolvedCheckOptions {
  language: SupportedLanguage;
  include_suggestions: boolean;
  include_rule_ids: boolean;
}

export function grammarFailure(
  code: GrammarErrorCode,
  message: string,
  retryAfterSeconds: number | null = null,
): GrammarFailure {
  return {
    contract_version: CONTRACT_VERSION,
    success: false,
    error: { code, message, retry_after_s: retryAfterSeconds },
  };
}

/**
 * Deterministic ordering: ascending by `start`, then `end`, then `rule_id`
 * (lexicographic, null last). Remaining ties keep engine emission order.
 */
export function sortIssues(issues: Issue[]): Issue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      if (a.issue.start !== b.issue.start) return a.issue.start - b.issue.start;
      if (a.issue.end !== b.issue.end) return a.issue.end - b.issue.end;
      const left = a.issue.rule_id;
      const right = b.issue.rule_id;
      if (left !== right) {
        if (left === null) return 1;
        if (right === null) return -1;
        return left < right ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.issue);
}

/** The engine-shaped input this module accepts, decoupled from harper.js types. */
export interface RawLint {
  rule_id: string | null;
  kind: string | null;
  message: string;
  start: number;
  end: number;
  /** Replacement strings only — deletions and insertions are not auto-applied. */
  replacements: string[];
}

export function resolveOptions(options: CheckGrammarOptions = {}): ResolvedCheckOptions {
  return {
    language: SUPPORTED_LANGUAGE,
    include_suggestions: options.include_suggestions !== false,
    include_rule_ids: options.include_rule_ids !== false,
  };
}

/** Synchronous, dependency-free FNV-1a-seeded digest fallback. */
function fallbackDigest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

/** Stable issue id: first 12 hex characters of sha-256(`rule_id:start:end`). */
export async function issueId(ruleId: string | null, start: number, end: number): Promise<string> {
  const material = `${ruleId ?? ""}:${start}:${end}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackDigest(material);
  const bytes = new TextEncoder().encode(material);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

function clampSpan(start: number, end: number, length: number): { start: number; end: number } {
  const safeStart = Math.max(0, Math.min(Math.trunc(start), length));
  const safeEnd = Math.max(safeStart, Math.min(Math.trunc(end), length));
  return { start: safeStart, end: safeEnd };
}

export async function normalizeLints(
  text: string,
  lints: readonly RawLint[],
  options: ResolvedCheckOptions,
  processingMs: number,
): Promise<GrammarSuccess> {
  const documentLength = text.length;
  const issues: Issue[] = await Promise.all(
    lints.map(async (lint): Promise<Issue> => {
      const { start, end } = clampSpan(lint.start, lint.end, documentLength);
      const ruleId = options.include_rule_ids ? (lint.rule_id ?? null) : null;
      const suggestions = options.include_suggestions
        ? lint.replacements.filter((entry) => typeof entry === "string")
        : [];
      return {
        id: await issueId(lint.rule_id ?? null, start, end),
        rule_id: ruleId,
        category: (lint.kind ?? "other").toLowerCase() || "other",
        message: lint.message,
        start,
        end,
        original_text: text.slice(start, end),
        suggestions,
        // Auto-apply only when the engine is unambiguous: exactly one replacement.
        safe: lint.replacements.length === 1,
      };
    }),
  );
  const sorted = sortIssues(issues);
  return {
    contract_version: CONTRACT_VERSION,
    success: true,
    language: SUPPORTED_LANGUAGE,
    document_length: documentLength,
    issue_count: sorted.length,
    issues: sorted,
    processing_ms: Math.max(0, Math.round(processingMs)),
  };
}

export interface ValidationInput {
  text: unknown;
  language?: unknown;
  maxChars: number;
}

/** Returns a failure to hand straight back to the caller, or null when valid. */
export function validateCheckRequest(input: ValidationInput): GrammarFailure | null {
  const { text, language, maxChars } = input;
  if (typeof text !== "string") {
    return grammarFailure("invalid_input", "`text` must be a string.");
  }
  if (text.trim().length === 0) {
    return grammarFailure("invalid_input", "`text` must not be empty.");
  }
  if (text.length > maxChars) {
    return grammarFailure(
      "too_large",
      `\`text\` is ${text.length} characters; the limit is ${maxChars}.`,
    );
  }
  if (language !== undefined && language !== null) {
    if (typeof language !== "string" || language.toLowerCase().split("-")[0] !== SUPPORTED_LANGUAGE) {
      return grammarFailure(
        "unsupported_language",
        `Only "${SUPPORTED_LANGUAGE}" (English) is supported. Received "${String(language)}".`,
      );
    }
  }
  return null;
}

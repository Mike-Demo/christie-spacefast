/**
 * POST /mcp — JSON-RPC 2.0 MCP endpoint.
 *
 * - `initialize` / `notifications/initialized` — handshake.
 * - `tools/list` — returns the `check_grammar` tool definition.
 * - `tools/call` `check_grammar` — requires an authenticated session cookie.
 *   Validates input (English only, max chars), rate-limits (hourly, per user,
 *   same semantics as the original `consume_rate_limit`), runs Harper via the
 *   runtime-loaded WASM, and records a usage event (counters only — the
 *   submitted text is never stored or logged).
 *
 * Response shapes mirror the original `toJson` in
 * `src/lib/mcp/tools/check-grammar.ts`.
 */
import { checkText } from "./_core/harper";
import { getSession } from "./_core/auth";
import {
  grammarFailure,
  validateCheckRequest,
  type GrammarResult,
} from "./_core/grammar";
import { json, withErrors } from "./_core/http";
import { first, newId, run } from "./_core/db";
import { initRequest, type CoreEnv, type RouteContext } from "./_core/request";

const OPERATION = "check_grammar";

/** Operational limits: env overrides, else the original defaults. */
function readLimits(env: CoreEnv): { maxCharsPerRequest: number; checksPerHour: number; requestTimeoutMs: number } {
  const positiveInt = (raw: string | undefined, fallback: number): number => {
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    maxCharsPerRequest: positiveInt(env.MAX_CHARS_PER_REQUEST, 10_000),
    checksPerHour: positiveInt(env.CHECKS_PER_HOUR, 60),
    requestTimeoutMs: positiveInt(env.REQUEST_TIMEOUT_MS, 10_000),
  };
}

const CHECK_GRAMMAR_TOOL = {
  name: "check_grammar",
  title: "Check grammar",
  description:
    "Check English text for grammar, spelling, punctuation and style problems using the Harper engine. Returns structured findings with character offsets and suggested replacements. The submitted text is processed in memory only and is never stored or logged.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The English text to check. Required." },
      language: {
        type: "string",
        description: "Language code. Only 'en' is supported; anything else is rejected.",
      },
      include_suggestions: {
        type: "boolean",
        description: "Include suggested replacements for each finding. Defaults to true.",
      },
      include_rule_ids: {
        type: "boolean",
        description: "Include the Harper rule identifier for each finding. Defaults to true.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

/** Plain-JSON grammar result, mirroring the original `toJson`. */
function toJson(result: GrammarResult): Record<string, unknown> {
  if (!result.success) {
    return {
      success: false,
      contract_version: result.contract_version,
      error: {
        code: result.error.code,
        message: result.error.message,
        retry_after_s: result.error.retry_after_s,
      },
    };
  }
  return {
    success: true,
    contract_version: result.contract_version,
    language: result.language,
    document_length: result.document_length,
    issue_count: result.issue_count,
    processing_ms: result.processing_ms,
    issues: result.issues.map((issue) => ({
      id: issue.id,
      rule_id: issue.rule_id,
      category: issue.category,
      message: issue.message,
      start: issue.start,
      end: issue.end,
      original_text: issue.original_text,
      suggestions: issue.suggestions.map((s) => s),
      safe: issue.safe,
    })),
  };
}

/** MCP tool-call envelope: text content + structured content. */
function toToolResult(result: GrammarResult): Record<string, unknown> {
  const payload = toJson(result);
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(result.success ? {} : { isError: true }),
  };
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function rpcError(id: unknown, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function rpcResult(id: unknown, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

/**
 * Fixed one-hour-window rate limiting, keyed on the authenticated user.
 * Same semantics as the original `consume_rate_limit`: atomic increment of
 * the caller's current UTC hour bucket; allowed while the new count is
 * within the limit; retry_after_s counts down to the next hour boundary.
 */
async function consumeRateLimit(
  env: CoreEnv,
  userId: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfterS: number }> {
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
  );
  const windowStartIso = windowStart.toISOString();
  const nowIso = now.toISOString();

  await run(
    env.db,
    `INSERT INTO rate_limits (user_id, window_start, \`count\`, updated_at)
     VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE \`count\` = \`count\` + 1, updated_at = ?`,
    userId,
    windowStartIso,
    nowIso,
    nowIso,
  );
  const row = await first(
    env.db,
    "SELECT `count` FROM rate_limits WHERE user_id = ? AND window_start = ?",
    userId,
    windowStartIso,
  );
  const count = Number(row?.["count"] ?? 1);
  const retryAfterS = Math.max(
    0,
    Math.ceil((windowStart.getTime() + 3_600_000 - Date.now()) / 1000),
  );
  return { allowed: count <= limit, retryAfterS };
}

/** Records counters only — never the submitted text. */
async function recordUsageEvent(
  env: CoreEnv,
  userId: string,
  result: GrammarResult,
  characterCount: number,
  latencyMs: number,
): Promise<void> {
  await run(
    env.db,
    `INSERT INTO usage_events
       (id, user_id, created_at, operation, character_count, issue_count, success, error_code, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    userId,
    new Date().toISOString(),
    OPERATION.slice(0, 64),
    Math.max(0, Math.trunc(characterCount)),
    result.success ? result.issue_count : 0,
    result.success ? 1 : 0,
    result.success ? null : result.error.code.slice(0, 64),
    Math.max(0, Math.round(latencyMs)),
  );
}

interface CheckGrammarArgs {
  text?: unknown;
  language?: unknown;
  include_suggestions?: unknown;
  include_rule_ids?: unknown;
}

async function callCheckGrammar(
  env: CoreEnv,
  request: Request,
  args: CheckGrammarArgs,
): Promise<Record<string, unknown>> {
  const user = await getSession(env, request);
  if (!user) {
    return toToolResult(
      grammarFailure("unauthorized", "Sign in to this app to use the grammar checker."),
    );
  }

  const limits = readLimits(env);
  const invalid = validateCheckRequest({
    text: args.text,
    language: args.language,
    maxChars: limits.maxCharsPerRequest,
  });
  if (invalid) return toToolResult(invalid);

  const text = args.text as string;
  const gate = await consumeRateLimit(env, user.id, limits.checksPerHour);
  if (!gate.allowed) {
    return toToolResult(
      grammarFailure(
        "rate_limited",
        `Hourly limit of ${limits.checksPerHour} checks reached. Try again in ${gate.retryAfterS} seconds.`,
        gate.retryAfterS,
      ),
    );
  }

  const startedAt = Date.now();
  const result = await checkText(text, {
    request,
    wasmBaseUrl: env.WASM_BASE_URL,
    maxChars: limits.maxCharsPerRequest,
    timeoutMs: limits.requestTimeoutMs,
    includeSuggestions: args.include_suggestions !== false,
    includeRuleIds: args.include_rule_ids !== false,
  });
  const latencyMs = Date.now() - startedAt;

  // Counters only: character counts and timings, never the text itself.
  await recordUsageEvent(env, user.id, result, text.length, latencyMs);

  return toToolResult(result);
}

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "POST") {
    return json({ error: "Method not allowed.", code: "invalid_request" }, 405);
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error: request body must be JSON.");
  }
  if (Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(
      (body as JsonRpcRequest)?.id ?? null,
      -32600,
      "Invalid Request: expected a JSON-RPC 2.0 object with a method.",
    );
  }

  const { id, method, params } = body;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "ceo-owl", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: [CHECK_GRAMMAR_TOOL] });
  }

  if (method === "tools/call") {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (p.name !== "check_grammar") {
      return rpcError(id, -32602, `Unknown tool: ${String(p.name ?? "")}.`);
    }
    const result = await callCheckGrammar(env, request, (p.arguments ?? {}) as CheckGrammarArgs);
    return rpcResult(id, result);
  }

  return rpcError(id, -32601, `Method not found: ${method}.`);
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

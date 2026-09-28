/**
 * Per-request context for SpaceFast function routes.
 */
import { ensureSchema, type SpacefastDb } from "./db";

export interface CoreEnv {
  db: SpacefastDb;
  /** HMAC secret for signing session cookies. Required for auth routes. */
  SESSION_SECRET?: string | undefined;
  /** Base URL for the published Harper WASM asset. Optional; derived from request origin otherwise. */
  WASM_BASE_URL?: string | undefined;
  /** Override operational limits. Optional. */
  MAX_CHARS_PER_REQUEST?: string | undefined;
  CHECKS_PER_HOUR?: string | undefined;
  REQUEST_TIMEOUT_MS?: string | undefined;
}

export interface CoreContext {
  env: CoreEnv;
  /** Caller IP as resolved from proxy headers, or "unknown". */
  ip: string;
}

/** The context object the SpaceFast runtime passes alongside the request. */
export interface RouteContext {
  request: Request;
  params: Record<string, string | string[] | undefined>;
  env: Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getClientIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct) return direct;
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

export async function initRequest(request: Request, context: RouteContext): Promise<CoreContext> {
  const rawDb = context.env["DB"];
  if (!rawDb || typeof (rawDb as { prepare?: unknown }).prepare !== "function") {
    throw new Error("The database binding (env.DB) is not configured for this space.");
  }
  const db = rawDb as SpacefastDb;
  await ensureSchema(db);
  return {
    env: {
      db,
      SESSION_SECRET: asString(context.env["SESSION_SECRET"]),
      WASM_BASE_URL: asString(context.env["WASM_BASE_URL"]),
      MAX_CHARS_PER_REQUEST: asString(context.env["MAX_CHARS_PER_REQUEST"]),
      CHECKS_PER_HOUR: asString(context.env["CHECKS_PER_HOUR"]),
      REQUEST_TIMEOUT_MS: asString(context.env["REQUEST_TIMEOUT_MS"]),
    },
    ip: getClientIp(request),
  };
}

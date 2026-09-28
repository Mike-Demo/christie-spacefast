/**
 * POST /api/auth/logout — clears the session cookie.
 */
import { apiError, json, withErrors } from "../../_core/http";
import { clearSessionCookie } from "../../_core/auth";
import { initRequest, type RouteContext } from "../../_core/request";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

/**
 * GET /api/auth/me — returns the signed-in user, or { user: null }.
 */
import { apiError, json, withErrors } from "../../_core/http";
import { getSession } from "../../_core/auth";
import { initRequest, type RouteContext } from "../../_core/request";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "GET") return apiError(405, "invalid_request", "Method not allowed.");
  const user = await getSession(env, request);
  if (!user) return json({ user: null });
  return json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    },
  });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

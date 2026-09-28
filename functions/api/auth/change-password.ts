/**
 * POST /api/auth/change-password — signed-in users set a new password.
 * Body { currentPassword, newPassword } →
 *   success: { ok: true }
 *   failure: { ok: false, error, message }
 */
import { apiError, AuthError, InputError, json } from "../../_core/http";
import {
  createSessionCookie,
  getSession,
  hashPassword,
  verifyPassword,
  withAuthErrors,
} from "../../_core/auth";
import { first, run } from "../../_core/db";
import { initRequest, type RouteContext } from "../../_core/request";

interface ChangeBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

const handle = withAuthErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");

  const user = await getSession(env, request);
  if (!user) throw new AuthError();

  let body: ChangeBody;
  try {
    body = (await request.json()) as ChangeBody;
  } catch {
    throw new InputError("invalid_request", "Request body must be JSON.");
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) {
    throw new InputError("invalid_request", "Current and new passwords are required.");
  }
  if (newPassword.length < 8) {
    throw new InputError("invalid_request", "The new password must be at least 8 characters.");
  }

  const row = await first(env.db, "SELECT password_hash FROM users WHERE id = ?", user.id);
  if (!row || !(await verifyPassword(currentPassword, String(row["password_hash"])))) {
    throw new InputError("invalid_credentials", "The current password didn't match.", 401);
  }

  await run(env.db, "UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(newPassword), user.id);
  // Rotate the session so a stolen cookie from before the change stops working.
  return json({ ok: true }, 200, { "Set-Cookie": await createSessionCookie(env, user.id) });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

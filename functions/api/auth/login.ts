/**
 * POST /api/auth/login — sign in with email + password.
 * Body { email, password } →
 *   success: { ok: true, user: { id, email, username, displayName, role } }
 *   failure: { ok: false, error, message }
 * Sets the httpOnly session cookie on success.
 */
import { apiError, InputError, json } from "../../_core/http";
import { createSessionCookie, verifyPassword, withAuthErrors } from "../../_core/auth";
import { first } from "../../_core/db";
import { initRequest, type RouteContext } from "../../_core/request";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

const handle = withAuthErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    throw new InputError("invalid_request", "Request body must be JSON.");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    throw new InputError("invalid_request", "Email and password are required.");
  }

  const row = await first(
    env.db,
    "SELECT id, email, username, display_name, password_hash FROM users WHERE LOWER(email) = LOWER(?)",
    email,
  );
  const hash = row ? String(row["password_hash"]) : "";
  const ok = row ? await verifyPassword(password, hash) : false;
  if (!row || !ok) {
    // Same response for unknown email and wrong password: no account oracle.
    throw new InputError("invalid_credentials", "That email and password didn't match.", 401);
  }

  const userId = String(row["id"]);
  const roleRow = await first(env.db, "SELECT role FROM user_roles WHERE user_id = ? LIMIT 1", userId);

  return json(
    {
      ok: true,
      user: {
        id: userId,
        email: String(row["email"]),
        username: String(row["username"]),
        displayName: row["display_name"] != null ? String(row["display_name"]) : null,
        role: roleRow ? String(roleRow["role"]) : null,
      },
    },
    200,
    { "Set-Cookie": await createSessionCookie(env, userId) },
  );
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

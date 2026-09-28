/**
 * POST /api/auth/register — create a preview account.
 * Body { username, email, password } →
 *   success: { ok: true, user: { id, email, username, displayName, role } }
 *   failure: { ok: false, error, message }
 * The first-ever registered user gets the `admin` role.
 */
import { apiError, InputError, json } from "../../_core/http";
import {
  createSessionCookie,
  grantAdminRole,
  hashPassword,
  isFirstUser,
  withAuthErrors,
} from "../../_core/auth";
import { first, newId, run } from "../../_core/db";
import { initRequest, type RouteContext } from "../../_core/request";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterBody {
  username?: unknown;
  email?: unknown;
  password?: unknown;
}

const handle = withAuthErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    throw new InputError("invalid_request", "Request body must be JSON.");
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!USERNAME_PATTERN.test(username)) {
    throw new InputError("invalid_request", "Usernames use 3–24 letters, numbers or underscores.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new InputError("invalid_request", "Enter a valid email address.");
  }
  if (password.length < 8) {
    throw new InputError("invalid_request", "Password must be at least 8 characters.");
  }

  const takenName = await first(env.db, "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", username);
  if (takenName) throw new InputError("username_taken", "That username is already taken.", 409);
  const takenEmail = await first(env.db, "SELECT id FROM users WHERE LOWER(email) = LOWER(?)", email);
  if (takenEmail) throw new InputError("email_taken", "An account with that email already exists.", 409);

  const firstUser = await isFirstUser(env.db);
  const id = newId();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  await run(
    env.db,
    `INSERT INTO users (id, email, username, display_name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    email,
    username,
    username,
    passwordHash,
    now,
  );
  if (firstUser) await grantAdminRole(env.db, id);

  return json(
    {
      ok: true,
      user: { id, email, username, displayName: username, role: firstUser ? "admin" : null },
    },
    200,
    { "Set-Cookie": await createSessionCookie(env, id) },
  );
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

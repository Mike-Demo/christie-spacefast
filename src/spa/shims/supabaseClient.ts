/**
 * SpaceFast preview compatibility shim for `@/integrations/supabase/client`.
 *
 * The original pages only ever touch a small part of the Supabase surface:
 * - `supabase.auth.getSession()` / `signInWithPassword()` / `signUp()` /
 *   `signOut()` / `onAuthStateChange()` (auth.tsx, connect.tsx, useAuth)
 * - `supabase.rpc("has_role", ...)` and `supabase.rpc("usage_health_summary")`
 *   (health.tsx)
 *
 * Everything here is backed by `fetch` against the preview Functions
 * backend. No Supabase keys, no Supabase JS client in the bundle.
 *
 * Expected backend shapes (tolerant parsing — bare or wrapped forms work):
 * - `POST /api/auth/register` `{ email, password }` -> `{ ok, user?, error?, message? }`
 * - `POST /api/auth/login`    `{ email, password }` -> `{ ok, user?, error?, message? }`
 * - `POST /api/auth/logout`                         -> `{ ok }`
 * - `GET  /api/auth/me`                             -> `{ user: {...} | null }`
 *   (a bare user object is also accepted)
 * - `GET  /api/health/summary`                      -> `{ buckets | rows | data }`
 */

export interface PreviewUser {
  id: string;
  email: string;
  username?: string | null;
  displayName?: string | null;
  role?: string | null;
}

export interface PreviewSession {
  user: PreviewUser;
}

export interface AuthError {
  message: string;
}

interface AuthResponseBody {
  ok?: boolean;
  error?: string;
  message?: string;
}

type AuthListener = (session: PreviewSession | null) => void;

const listeners = new Set<AuthListener>();
let cachedSession: PreviewSession | null | undefined;

function setSession(session: PreviewSession | null): void {
  cachedSession = session;
  for (const listener of listeners) {
    try {
      listener(session);
    } catch {
      // A listener must never break auth state propagation.
    }
  }
}

function normalizeUser(raw: unknown): PreviewUser | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r["id"];
  const email = r["email"];
  if (typeof id !== "string" || typeof email !== "string") return null;
  return {
    id,
    email,
    username: typeof r["username"] === "string" ? r["username"] : null,
    displayName: typeof r["displayName"] === "string" ? r["displayName"] : null,
    role: typeof r["role"] === "string" ? r["role"] : null,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Refresh the cached session from `GET /api/auth/me`. */
export async function refreshSession(): Promise<PreviewSession | null> {
  try {
    const res = await fetch("/api/auth/me", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      setSession(null);
      return null;
    }
    const body = (await readJson(res)) as { user?: unknown } | null;
    const user = normalizeUser(body && typeof body === "object" && "user" in body ? body.user : body);
    const session = user ? { user } : null;
    setSession(session);
    return session;
  } catch {
    setSession(null);
    return null;
  }
}

async function postAuth(
  path: "/api/auth/login" | "/api/auth/register",
  email: string,
  password: string,
): Promise<{ error: AuthError | null }> {
  let parsed: AuthResponseBody | null = null;
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    parsed = (await readJson(res)) as AuthResponseBody;
    if (!res.ok || parsed?.ok === false) {
      const message =
        parsed?.message || parsed?.error || "That didn't work. Please try again.";
      return { error: { message } };
    }
  } catch {
    return { error: { message: "Could not reach the server. Check your connection and try again." } };
  }
  await refreshSession();
  return { error: null };
}

export const supabase = {
  auth: {
    getSession: async (): Promise<{ data: { session: PreviewSession | null } }> => {
      const session = cachedSession !== undefined ? cachedSession : await refreshSession();
      return { data: { session } };
    },

    signInWithPassword: async (input: {
      email: string;
      password: string;
    }): Promise<{ error: AuthError | null }> => {
      return postAuth("/api/auth/login", input.email, input.password);
    },

    signUp: async (input: {
      email: string;
      password: string;
      options?: { emailRedirectTo?: string };
    }): Promise<{ error: AuthError | null }> => {
      // The preview has no email delivery: registration signs the user in
      // immediately, so there is no "check your inbox" step.
      return postAuth("/api/auth/register", input.email, input.password);
    },

    signOut: async (): Promise<{ error: AuthError | null }> => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { accept: "application/json" },
          credentials: "same-origin",
        });
      } catch {
        // Logging out is best-effort; the local session is cleared regardless.
      }
      setSession(null);
      return { error: null };
    },

    onAuthStateChange: (
      callback: (event: string, session: PreviewSession | null) => void,
    ): { data: { subscription: { unsubscribe: () => void } } } => {
      const listener: AuthListener = (session) => callback("SIGNED_IN", session);
      listeners.add(listener);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(listener);
            },
          },
        },
      };
    },
  },

  rpc: async (
    name: "has_role" | "usage_health_summary" | string,
    params?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: AuthError | null }> => {
    try {
      if (name === "has_role") {
        const session = cachedSession !== undefined ? cachedSession : await refreshSession();
        const want = typeof params?.["_role"] === "string" ? params["_role"] : "admin";
        return { data: session?.user?.role === want, error: null };
      }
      if (name === "usage_health_summary") {
        const res = await fetch("/api/health/summary", {
          headers: { accept: "application/json" },
          credentials: "same-origin",
        });
        const body = (await readJson(res)) as
          | { buckets?: unknown; rows?: unknown; data?: unknown }
          | unknown[]
          | null;
        if (!res.ok) {
          return { data: null, error: { message: `Health summary failed (${res.status}).` } };
        }
        const data =
          (body && typeof body === "object" && !Array.isArray(body)
            ? (body.buckets ?? body.rows ?? body.data)
            : body) ?? [];
        return { data, error: null };
      }
      return { data: null, error: { message: `Unknown function "${name}".` } };
    } catch {
      return { data: null, error: { message: "Could not reach the server." } };
    }
  },
};

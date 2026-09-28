# CEO Owl SpaceFast Migration Contract

## Goal
Isolated preview of CEO Owl (privacy-first English grammar checker) on SpaceFast.
**Never touch Lovable production (ceoowl.com), the original repo's main branch, DNS, or domains.**

- Fork: `Mike-Demo/christie-spacefast`, branch `spacefast-migration`
- Preview slug: `ceo-owl-preview` → `https://ceo-owl-preview.view.fast/`

## Architecture
- **Static React SPA**: built with a dedicated `vite.spa.config.ts` + `spa.html`, reusing the
  existing TanStack Router pages via fetch-backed shims in `src/spa/`.
- **SpaceFast Functions backend**: `functions/` tree only. Each file exports one const per
  HTTP method (`export const GET = handle;` etc., where
  `handle = withErrors(async (request: Request, context: RouteContext) => ...)`).
  Use `initRequest(request, context)` from `_core/request.ts` to get `{ env, ip }`.
- **D1 database**: binding `DB`. Schema (create in `_core/db.ts` `ensureSchema`):
  - `users(id TEXT PK, email TEXT UNIQUE, username TEXT UNIQUE, display_name TEXT, password_hash TEXT, created_at TEXT)`
  - `user_roles(user_id TEXT, role TEXT, created_at TEXT, UNIQUE(user_id, role))`
  - `usage_events(id TEXT PK, user_id TEXT, created_at TEXT, operation TEXT, character_count INT, issue_count INT, success INT, error_code TEXT, latency_ms INT)`
  - `rate_limits(user_id TEXT, window_start TEXT, count INT, updated_at TEXT, PK(user_id, window_start))`
- **Auth**: preview-local email/password. PBKDF2-SHA256 password hashing, HMAC-signed
  HTTP-only session cookies. `SESSION_SECRET` env required. First registered user becomes admin.
- **Harper in Functions**: Harper's 16MB WASM cannot be bundled, and the SpaceFast
  edge runtime blocks WebAssembly compilation (`CompileError: ... disallowed by
  embedder`), so runtime-loaded WASM fails in Functions. `checkText` catches
  this and falls back to a pure-JS checker (`functions/_core/js-checker.ts`)
  covering repeated words, spacing, capitalization, a/an agreement, and common
  misspellings. The browser editor at `/editor` runs the full Harper WASM locally.

## Public routes (SPA)
- `/` — landing
- `/editor` — in-browser grammar checker (Harper WASM in browser; text never leaves device)
- `/connect` — MCP client info (simplified: no Gravatar OAuth in preview)
- `/auth` — sign-in / register
- `/docs`, `/licenses`, `/privacy`, `/terms` — static pages
- `/health` — admin-only usage dashboard

## Backend endpoints
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`, `POST /api/auth/change-password`
- `POST /mcp` — JSON-RPC MCP endpoint:
  - `tools/list` → `check_grammar` tool definition (same input schema as original)
  - `tools/call` `check_grammar` → requires auth (session cookie), validates input
    (English only, max chars), rate-limits (hourly, per user), runs Harper via
    runtime-loaded WASM, records usage event (counters only, never text).
  - Returns the same JSON shape as the original (`success`, `contract_version`,
    `issues[]` with `id/rule_id/category/message/start/end/original_text/suggestions[]/safe`).
- `GET /api/health/summary` — admin-only aggregated usage counters (7-day hourly buckets).
- `GET /api/public/gravatar/start`, `GET /api/public/gravatar/callback` — **DEFERRED**.
  Gravatar/WordPress.com OAuth is not in the preview. The frontend shows "not available".

## Preserved interfaces
- `/mcp` (JSON-RPC: `tools/list`, `tools/call`)
- `/llms.txt`, `/sitemap.xml`, `/carbon.txt`, `/robots.txt`, `/og-image.png`
- `/.well-known/` routes that exist
- Private analytics (Lite Analytics script)
- Preview `noindex, nofollow`

## Intentionally deferred
- Gravatar/WordPress.com OAuth sign-in
- Lovable Cloud auth, Supabase auth
- The standalone Harper Docker service (replaced by runtime WASM loading in Functions)
- Full OAuth 2.1 flow for MCP (session cookie auth instead for the preview)

## Limits (match original)
- Max chars per check request (see `src/lib/grammar/config.ts` `DEFAULT_LIMITS`)
- Hourly check limit per user
- Request timeout

## Verification
- `bun x vite build --config vite.spa.config.ts` succeeds
- Scoped `tsc --noEmit` clean for new/changed files
- Per-file `bun build` on all `functions/` files
- Secret scan on built output
- Live: homepage, editor page loads, auth flow, MCP `tools/list` + `check_grammar` call,
  rate limiting, health dashboard (admin), static files

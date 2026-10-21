# Security audit triage — 2026-10-21

Audit result: **0 confirmed findings, 5 needs-validation leads, 0 rejected candidates.**

There are no confirmed findings to prioritize or create remediation issues for. The audit request asks for one checklist issue for the leads. Issue creation is not available in this session, so the following is ready to file as a draft:

## Issue title

`[security][needs-validation] Audit leads to validate`

## Issue body

This checklist tracks the five needs-validation leads from the 2026-10-21 security audit. Each item remains unconfirmed until its stated missing fact is established. **Do not assign severity to these leads.**

Parent: Mike-Demo/christie-spacefast#1

- [ ] **Gravatar sign-in transports the one-time Supabase magic-link token hash in a redirect URL query string**
  - Fingerprint: `gravatar-magiclink-token-hash-in-url`
  - Claimed root cause: A bearer session credential (Supabase magic-link hashed_token) is handed off via a URL query parameter instead of a cookie, POST body, or server-side one-time code exchange.
  - Exact missing fact: Supabase project configuration not in this repo: whether the magiclink hashed_token is strictly single-use and what its configured expiry is for the project referenced in supabase/config.toml.

- [ ] **Companion Harper service is unauthenticated when HARPER_SERVICE_TOKEN is unset, bypassing MCP OAuth and the per-user hourly quota**
  - Fingerprint: `harper-service-optional-token-bypasses-mcp-quota`
  - Claimed root cause: The Harper service fails open: authorized() grants access to all callers when the optional shared token environment variable is unset.
  - Exact missing fact: Production deployment fact not in this repo: whether HARPER_SERVICE_TOKEN is actually set in the deployed Harper container environment.

- [ ] **Harper service parses the full request JSON before enforcing MAX_CHARS, with no request-body size limit**
  - Fingerprint: `harper-service-unbounded-json-body`
  - Claimed root cause: Size enforcement happens after full JSON parsing, and no server-level request-body cap is configured, so parse-time buffering is unbounded in source.
  - Exact missing fact: External runtime fact not in this repo: the deployed Bun 1.3 runtime's built-in default maxRequestBodySize and whether it applies before request.json() buffering.

- [ ] **MCP handler trusts X-Forwarded-Host and X-Forwarded-Proto unconditionally, while the sibling OAuth metadata route documents that this is safe only behind a proxy that overwrites both headers**
  - Fingerprint: `mcp-trust-forwarded-host-metadata`
  - Claimed root cause: The MCP handler trusts client-controllable forwarding headers for OAuth resource metadata without the platform-trust condition documented on the sibling route.
  - Exact missing fact: Hosting proxy fact not in this repo: whether the actual proxy in front of this deployment overwrites or strips client-supplied X-Forwarded-Host and X-Forwarded-Proto.

- [ ] **saveThemeDefaults server function allows any unauthenticated caller to overwrite a server source file; only guard is NODE_ENV not equal to production**
  - Fingerprint: `unauthenticated-theme-css-server-write`
  - Claimed root cause: A server function that writes caller-supplied content to an application source file relies solely on a NODE_ENV value as its guard and attaches no authentication or authorization middleware.
  - Exact missing fact: Deployment reachability fact not in this repo: whether the saveThemeDefaults server function is included and reachable in the deployed bundle, since it has no importer in this repo.

# Authentication

How AI agents authenticate with CEO Owl.

## Discover

CEO Owl offers a privacy-first grammar checker. The web editor requires no authentication.
The MCP server requires OAuth sign-in.

## Pick a method

- **Web editor** (https://ceoowl.com/): no authentication. Text is processed on-device.
- **MCP server** (https://ceoowl.com/mcp): OAuth via Supabase. Sign in once, then connect.

## Register

For MCP access, sign in at https://ceoowl.com/ with your account.

## Claim

Connect to the MCP endpoint with your authenticated session.

## Exchange

OAuth tokens are handled by Supabase. See https://ceoowl.com/docs for client configuration.

## Use the access_token

Include the bearer token in MCP requests per the MCP specification.

## Errors

401 Unauthorized is returned for unauthenticated MCP requests.

## Revocation

Sign out at https://ceoowl.com/ to revoke access.

## agent_auth

- `identity_endpoint`: https://ceoowl.com/
- `identity_types_supported`: ["anonymous", "service_auth"]

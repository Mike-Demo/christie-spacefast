/**
 * SpaceFast preview shim for `@/lib/connected-clients`.
 *
 * Connected clients are OAuth grants held by the authorization server. The
 * full OAuth 2.1 flow is intentionally deferred in the preview, so there are
 * never any grants to list: the connect page renders its "not available"
 * state instead of a client list.
 */
export interface ConnectedClient {
  id: string;
  name: string;
  connectedAt?: string;
}

/** Always null: grant listing is not available in the preview. */
export async function listConnectedClients(): Promise<ConnectedClient[] | null> {
  return null;
}

/** No-op: there is nothing to revoke in the preview. */
export async function revokeConnectedClient(_id: string): Promise<void> {}

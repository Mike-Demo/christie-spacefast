/**
 * SpaceFast preview shim for `@/integrations/lovable`.
 *
 * Lovable Cloud auth (including Google OAuth) does not exist in the preview.
 * The auth page keeps its email/password form; OAuth buttons surface this
 * message instead of starting a flow that can never complete.
 */
export const lovable = {
  auth: {
    signInWithOAuth: async (
      _provider: string,
      _opts?: { redirect_uri?: string; extraParams?: Record<string, string> },
    ): Promise<{ redirected: false; error: Error }> => ({
      redirected: false,
      error: new Error(
        "Google sign-in is not available in the SpaceFast preview. Use email and password instead.",
      ),
    }),
  },
};

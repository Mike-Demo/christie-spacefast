import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import {
  WaButton,
  WaCallout,
  WaCard,
  WaDivider,
  WaIcon,
  WaInput,
} from "@/design-system/font-awsome-web-awesome-171158";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
// SpaceFast preview: Gravatar/WordPress.com OAuth is deferred.
import { GRAVATAR_UNAVAILABLE_MESSAGE } from "@/spa/shims/gravatar";

/** Only same-origin relative paths may be used as a post-sign-in destination. */
function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/connect";
  if (!value.startsWith("/") || value.startsWith("//")) return "/connect";
  return value;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { next: string; error?: string } => ({
    next: safeNext(search['next']),
    ...(search['error'] === "gravatar" ? { error: "gravatar" } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Sign in — CEO Owl" },
      {
        name: "description",
        content: "Sign in to connect an AI client to the CEO Owl grammar checker.",
      },
      { property: "og:title", content: "Sign in — CEO Owl" },
      { property: "og:description", content: "Sign in to connect an AI client." },
      { property: "og:image", content: "https://ceoowl.com/og-image.png" },
      { name: "twitter:image", content: "https://ceoowl.com/og-image.png" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { next, error: searchError } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    searchError === "gravatar"
      ? "Gravatar sign-in did not complete. Please try again or use another method."
      : null,
  );
  const emailRef = useRef<HTMLElement | null>(null);
  const passwordRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace(next);
    });
  }, [next]);

  const readValue = (ref: typeof emailRef) =>
    ((ref.current as (HTMLElement & { value?: string }) | null)?.value ?? "").trim();

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    const email = readValue(emailRef);
    const password = readValue(passwordRef);

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${next}` },
      });
      setBusy(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      setMessage("Check your inbox to confirm your address, then sign in.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    void navigate({ href: next });
  }, [mode, navigate, next]);

  const googleSignIn = useCallback(async () => {
    setError(null);
    // The destination is kept separately: OAuth must return to a public URL.
    sessionStorage.setItem("harper:next", next);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth/callback`,
    });
    if (result.error) {
      // SpaceFast preview: the Lovable shim returns a "not available" error.
      setError(
        result.error instanceof Error
          ? result.error.message
          : "Google sign-in could not be started. Please try again.",
      );
      return;
    }
    if (result.redirected) return;
    void navigate({ href: next });
  }, [navigate, next]);

  return (
    <AppShell>
      <section className="app-section-tight wa-stack wa-gap-m app-measure">
        <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
        <p>
          An account is only needed to connect an AI client. The browser editor works without
          signing in.
        </p>

        <WaCard>
          <div className="wa-stack wa-gap-s">
            {error ? (
              <WaCallout variant="danger">
                <WaIcon slot="icon" name="triangle-exclamation" />
                {error}
              </WaCallout>
            ) : null}
            {message ? (
              <WaCallout variant="success">
                <WaIcon slot="icon" name="envelope" />
                {message}
              </WaCallout>
            ) : null}

            <WaButton appearance="outlined" disabled={busy} onClick={() => void googleSignIn()}>
              <WaIcon slot="start" family="brands" name="google" />
              Continue with Google
            </WaButton>

            <WaButton
              appearance="outlined"
              disabled={busy}
              // SpaceFast preview: Gravatar OAuth is deferred, so say so
              // instead of navigating to a flow that cannot complete.
              onClick={() => setError(GRAVATAR_UNAVAILABLE_MESSAGE)}
            >
              <WaIcon slot="start" name="circle-user" />
              Continue with Gravatar
            </WaButton>

            <WaDivider />

            <WaInput ref={emailRef} label="Email" type="email" autocomplete="email" />
            <WaInput
              ref={passwordRef}
              label="Password"
              type="password"
              passwordToggle
              autocomplete={mode === "signin" ? "current-password" : "new-password"}
            />

            <WaButton variant="brand" disabled={busy} onClick={() => void submit()}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </WaButton>

            <WaButton
              appearance="plain"
              disabled={busy}
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin"
                ? "No account yet? Create one"
                : "Already have an account? Sign in"}
            </WaButton>
          </div>
        </WaCard>
      </section>
    </AppShell>
  );
}

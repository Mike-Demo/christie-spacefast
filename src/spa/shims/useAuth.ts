/**
 * SpaceFast preview shim for `@/hooks/useAuth`.
 *
 * Same public interface as the original hook (`{ session, user, loading }`)
 * but backed by the fetch-based preview auth client instead of Supabase.
 */
import { useEffect, useState } from "react";

import {
  refreshSession,
  supabase,
  type PreviewSession,
  type PreviewUser,
} from "./supabaseClient";

export interface AuthState {
  session: PreviewSession | null;
  user: PreviewUser | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });

    void refreshSession().then((next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}

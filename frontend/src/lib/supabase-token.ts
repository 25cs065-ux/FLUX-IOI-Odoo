// ---------------------------------------------------------------------------
// Supabase token accessor
//
// Replaces the original localStorage-scanning workaround with the official
// Supabase SDK session API.
//
// Design rules:
//   - getSupabaseToken()  — returns the current access token string, or null.
//     Calls refreshSession() automatically when the SDK deems it necessary
//     (autoRefreshToken is enabled on the client, so this is mainly a fallback).
//   - getSupabaseSession() — returns the full Session object.
//
// The 401-retry logic (refresh → retry → sign-out) lives in api-client.ts
// rather than here so this module stays a pure token accessor.
// ---------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

/**
 * Return the current Supabase access token, or null when the user is not
 * signed in.
 *
 * On the server (SSR) this always returns null because localStorage is not
 * available — use server-side session helpers if you need SSR auth.
 */
export async function getSupabaseToken(): Promise<string | null> {
  const session = await getSupabaseSession();
  return session?.access_token ?? null;
}

/**
 * Return the full Supabase Session object, or null when not signed in.
 * The SDK handles token refresh automatically when autoRefreshToken is true.
 */
export async function getSupabaseSession(): Promise<Session | null> {
  if (typeof window === "undefined") return null;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

/**
 * Attempt to refresh the current session.
 * Returns the new Session, or null if refresh fails (user must re-login).
 */
export async function refreshSupabaseSession(): Promise<Session | null> {
  if (typeof window === "undefined") return null;

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) return null;
  return data.session;
}

// ---------------------------------------------------------------------------
// Supabase browser client
//
// Single reusable client instance for the whole frontend.
// Only NEXT_PUBLIC_ variables are safe to use here — the service-role key
// must never appear in frontend code.
//
// The client is created lazily on first use so that server-side prerendering
// does not fail when env vars are not present in the build environment.
// The SSR client stores the session in cookies so the Next.js proxy can read
// it during navigation and page refreshes.
//
// Usage:
//   import { supabase } from "@/lib/supabase";
//   const { data, error } = await supabase.auth.signInWithPassword({ email, password });
// ---------------------------------------------------------------------------

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase browser client.
 * Throws a clear error in development if the env vars are missing.
 * In production SSR/build the function returns safely because auth pages
 * are client-only components and this code never runs on the server.
 */
function getClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "must be set. Add them to frontend/.env.local (never commit that file)."
    );
  }

  _client = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return _client;
}

// Export a Proxy so that callers can write `supabase.auth.signIn(…)` without
// having to call getClient() themselves, while still deferring initialization.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getClient()[prop as keyof SupabaseClient];
  },
});

// ---------------------------------------------------------------------------
// Supabase token accessor (no SDK required)
//
// Supabase stores its session in localStorage under the key:
//   sb-<project-ref>-auth-token
//
// Since @supabase/supabase-js is not installed in this project, this module
// reads the token directly from localStorage by scanning for the well-known
// key prefix. Falls back to null if the token is missing or expired.
//
// Usage:
//   import { getSupabaseToken } from "@/lib/supabase-token";
//   const token = getSupabaseToken();  // string | null
//   if (token) {
//     await apiClient.get("/subscriptions", { token });
//   }
// ---------------------------------------------------------------------------

const SUPABASE_KEY_PREFIX = "sb-";
const SUPABASE_KEY_SUFFIX = "-auth-token";

interface SupabaseStoredSession {
  access_token?: string;
  expires_at?: number; // unix timestamp (seconds)
}

/**
 * Read the Supabase access token from localStorage without the SDK.
 *
 * Returns the raw access_token string if a valid, non-expired session is
 * found, otherwise returns null.
 *
 * Safe to call in a browser environment; returns null on the server (SSR).
 */
export function getSupabaseToken(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (key.startsWith(SUPABASE_KEY_PREFIX) && key.endsWith(SUPABASE_KEY_SUFFIX)) {
        const raw = storage.getItem(key);
        if (!raw) continue;

        const session = JSON.parse(raw) as SupabaseStoredSession;
        const token = session?.access_token;
        if (!token) continue;

        // Check expiry — give a 30-second grace window.
        if (session.expires_at) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          if (nowSeconds >= session.expires_at - 30) {
            // Token expired or about to expire — do not return it.
            continue;
          }
        }

        return token;
      }
    }
  } catch {
    // localStorage may be unavailable (e.g. private browsing, SSR).
  }

  return null;
}

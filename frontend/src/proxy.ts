// ---------------------------------------------------------------------------
// proxy.ts — Route protection (Next.js 16)
//
// In Next.js 16 the middleware file is renamed to proxy.ts.
// This file checks the Supabase session stored in cookies by @supabase/ssr.
//
// Important: This is a UI guard, NOT a security boundary.
// The FastAPI backend enforces real authentication on every request.
//
// Protected routes (require a session):
//   /command-center, /subscriptions, /invoices, /payments, /portal/*
//   …and all other dashboard routes.
//
// Public routes (redirect to dashboard when already signed in):
//   /login, /register, /forgot-password, /reset-password, /verify-email
//
// Role enforcement (admin/staff vs customer):
//   Not done here — the backend enforces roles on every API call.
//   Frontend role-based UI (nav filtering, portal vs dashboard routing)
//   is handled in layout components using the Supabase session.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes that require a logged-in session.
// All paths not listed here or in PUBLIC_ROUTES are also protected.
const AUTH_ROUTES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

// After sign-in, redirect to this page.
const DEFAULT_REDIRECT = "/command-center";
// Where to send unauthenticated users.
const LOGIN_PATH = "/login";

/**
 * Detect whether a Supabase session cookie is present.
 *
 * Supabase SSR stores sessions in `sb-<ref>-auth-token` cookies, which may be
 * split into numbered chunks. The session itself is validated with getUser().
 *
 * This proxy only controls frontend redirects; the FastAPI backend validates
 * the JWT on every protected API call.
 */
function hasSupabaseSession(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  let response = NextResponse.next({ request });
  const authResponseHeaders: Record<string, string> = {};
  let sessionPresent = false;

  if (hasSupabaseSession(request)) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "[supabase] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
          "must be set. Add them to frontend/.env.local (never commit that file)."
      );
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.assign(authResponseHeaders, headers);
          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    });

    // getClaims() refreshes an expired session (updating the cookies above) and
    // verifies the access token against the project's published signing keys,
    // which are cached, so navigations and prefetches do not each wait on a
    // round trip to Supabase Auth the way getUser() does. An invalid or expired
    // session counts as signed out (redirect to login) instead of an error page.
    try {
      const { data, error } = await supabase.auth.getClaims();
      sessionPresent = !error && Boolean(data?.claims?.sub);
    } catch {
      sessionPresent = false;
    }
  }

  function redirectWithAuthCookies(url: URL) {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach(({ name, value, ...options }) => {
      redirectResponse.cookies.set(name, value, options);
    });
    Object.entries(authResponseHeaders).forEach(([name, value]) => {
      redirectResponse.headers.set(name, value);
    });
    return redirectResponse;
  }

  // Unauthenticated user hitting a protected route → send to login
  if (!isAuthRoute && !sessionPresent) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    // Preserve the intended destination so we can redirect back after login
    url.searchParams.set("next", pathname);
    return redirectWithAuthCookies(url);
  }

  // Authenticated user hitting an auth route → send to dashboard
  if (isAuthRoute && sessionPresent) {
    // Except for reset-password and verify-email which need to stay on their
    // page even while a session is active (the token-in-URL flow requires it).
    if (pathname === "/reset-password" || pathname === "/verify-email") {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = DEFAULT_REDIRECT;
    url.searchParams.delete("next");
    return redirectWithAuthCookies(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - files with an extension (public assets)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.[a-z]+$).*)",
  ],
};

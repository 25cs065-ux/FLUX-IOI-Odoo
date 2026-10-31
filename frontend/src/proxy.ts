// ---------------------------------------------------------------------------
// proxy.ts — Route protection (Next.js 16)
//
// In Next.js 16 the middleware file is renamed to proxy.ts.
// This file performs OPTIMISTIC session checks only, using the Supabase
// session cookie that @supabase/supabase-js writes to the browser.
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
 * @supabase/supabase-js (non-SSR) stores the session in localStorage
 * AND sets a same-site cookie with the key pattern `sb-<ref>-auth-token`.
 * We look for that cookie as an optimistic session indicator.
 *
 * This check is purely for redirect UX — it does NOT validate the token.
 * The FastAPI backend validates the JWT on every protected API call.
 */
function hasSupabaseSession(request: NextRequest): boolean {
  for (const [name] of request.cookies) {
    if (name.startsWith("sb-") && name.endsWith("-auth-token")) {
      return true;
    }
  }
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  const sessionPresent = hasSupabaseSession(request);

  // Unauthenticated user hitting a protected route → send to login
  if (!isAuthRoute && !sessionPresent) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    // Preserve the intended destination so we can redirect back after login
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
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
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
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

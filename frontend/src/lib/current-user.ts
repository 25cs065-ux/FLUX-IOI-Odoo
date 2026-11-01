// ---------------------------------------------------------------------------
// Signed-in user and role-based routing
//
// The role comes from the backend's GET /me, which uses the same role
// resolution that every API call enforces, so the UI and the API never
// disagree about who is a customer.
// ---------------------------------------------------------------------------

import { apiClient } from "@/lib/api-client";

export type UserRole = "admin" | "staff" | "customer";

export interface CurrentUser {
  id: string;
  email: string | null;
  role: UserRole;
  name: string | null;
  customer_id: string | null;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await apiClient.get<CurrentUser>("/me");
  if (!data) throw new Error("Could not load your account.");
  return data;
}

/** Where a role lands after signing in. */
export function homePathFor(role: UserRole): string {
  return role === "customer" ? "/portal" : "/command-center";
}

/** True when the role may open the given page (customers: portal only; staff: no portal). */
export function canAccessPath(role: UserRole, path: string): boolean {
  const inPortal = path === "/portal" || path.startsWith("/portal/");
  return role === "customer" ? inPortal : !inPortal;
}

const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"];

/**
 * The page to open after sign-in: the `next` parameter when it is a same-site
 * path the role may open, otherwise the role's home page. `next` is parsed the
 * way the browser will parse it, so "https://…", "//evil", "/\evil" and paths
 * hiding tabs or newlines ("/\t/evil") cannot send the user to another site,
 * and the returned path is the normalised one that was checked.
 */
export function postLoginPath(role: UserRole, next: string | null): string {
  const home = homePathFor(role);
  if (!next || !next.startsWith("/")) return home;

  const origin = "https://brightloop.invalid";
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return home;
  }
  const path = url.pathname;
  if (
    url.origin !== origin ||
    AUTH_PAGES.some((p) => path === p || path.startsWith(p + "/")) ||
    !canAccessPath(role, path)
  ) {
    return home;
  }
  return path + url.search + url.hash;
}

/** Two-letter initials for the avatar. */
export function initialsFor(user: Pick<CurrentUser, "name" | "email">): string {
  const source = (user.name || user.email || "?").trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  staff: "Staff",
  customer: "Customer",
};

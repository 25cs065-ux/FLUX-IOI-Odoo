"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessPath, homePathFor, type CurrentUser } from "@/lib/current-user";
import { supabase } from "@/lib/supabase";
import { clearApiCache } from "@/lib/api-client";

const CurrentUserContext = createContext<CurrentUser | null>(null);

/** The signed-in user inside a RoleGuard (null outside one). */
export function useSignedInUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}

/** Sign out, forget cached API responses, and go to the login page. */
export async function signOut(router: { replace: (href: string) => void }) {
  clearApiCache();
  await supabase.auth.signOut();
  router.replace("/login");
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">{children}</div>
  );
}

/**
 * Renders its children only for a user whose role may open the current page:
 * customers stay in /portal, admin and staff stay out of it. Anyone else is
 * sent to their own home page. The backend still enforces every permission;
 * this keeps people out of screens that are not meant for them.
 */
export function RoleGuard({ children }: { children: React.ReactNode }) {
  const { user, error, isLoading } = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = user ? canAccessPath(user.role, pathname) : false;

  useEffect(() => {
    if (user && !allowed) router.replace(homePathFor(user.role));
  }, [user, allowed, router]);

  if (error) {
    return (
      <FullScreen>
        <div className="max-w-sm text-center" role="alert">
          <p className="text-sm font-medium text-foreground">We couldn&apos;t load your account.</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Try again
            </button>
            <button
              onClick={() => void signOut(router)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </FullScreen>
    );
  }

  if (isLoading || !user || !allowed) {
    return (
      <FullScreen>
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </FullScreen>
    );
  }

  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

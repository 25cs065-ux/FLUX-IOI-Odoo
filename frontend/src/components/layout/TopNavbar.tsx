"use client";

import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "cn";
import { NAV_ITEMS } from "@/lib/navigation";
import { MobileMenuButton } from "./Sidebar";
import { useSignedInUser } from "./RoleGuard";
import { initialsFor, ROLE_LABELS } from "@/lib/current-user";


interface TopNavbarProps {
  onMobileMenuOpen: () => void;
}

/** Derives a readable page title from the current pathname via the nav config. */
function usePageTitle(): string {
  const pathname = usePathname();
  const match = NAV_ITEMS.find(
    (item) =>
      pathname === item.href || pathname.startsWith(item.href + "/")
  );
  return match?.label ?? "Dashboard";
}

export function TopNavbar({ onMobileMenuOpen }: TopNavbarProps) {
  const title = usePageTitle();

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center gap-3 border-b border-border bg-background px-4">
      {/* Mobile hamburger */}
      <MobileMenuButton onClick={onMobileMenuOpen} />

      {/* Page title / breadcrumb */}
      <h1 className="flex-1 text-sm font-semibold text-foreground truncate">
        {title}
      </h1>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button
          aria-label="Notifications"
          className="relative flex items-center justify-center rounded-md p-1.5 text-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
        >
          <Bell className="size-5" />
        </button>

        {/* User menu */}
        <UserMenu />
      </div>
    </header>
  );
}

/** The signed-in user's avatar, name and role. */
function UserMenu() {
  const user = useSignedInUser();
  if (!user) return null;
  const name = user.name || user.email || "Signed in";

  return (
    <div className="relative">
      <button
        aria-label={`Signed in as ${name}`}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-muted transition-colors"
      >
        {/* Avatar initials */}
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full",
            "bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold shrink-0"
          )}
          aria-hidden="true"
        >
          {initialsFor(user)}
        </span>
        {/* Name + role on md+ */}
        <span className="hidden md:flex flex-col items-start leading-tight">
          <span className="max-w-[200px] truncate font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {ROLE_LABELS[user.role]}
          </span>
        </span>
      </button>
    </div>
  );
}

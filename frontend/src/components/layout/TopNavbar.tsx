"use client";

import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "cn";
import { NAV_ITEMS } from "@/lib/navigation";
import { MobileMenuButton } from "./Sidebar";

/** Placeholder user — replace with real auth context when available. */
const PLACEHOLDER_USER = {
  name: "Alex Johnson",
  role: "Admin", // placeholder role — real role-based logic added later
  initials: "AJ",
};

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
          {/* Notification badge — placeholder */}
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive"
          />
        </button>

        {/* User menu */}
        <UserMenu />
      </div>
    </header>
  );
}

/** Minimal user avatar + dropdown placeholder. */
function UserMenu() {
  return (
    <div className="relative">
      <button
        aria-label={`User menu — ${PLACEHOLDER_USER.name}`}
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
          {PLACEHOLDER_USER.initials}
        </span>
        {/* Name + role on md+ */}
        <span className="hidden md:flex flex-col items-start leading-tight">
          <span className="font-medium">{PLACEHOLDER_USER.name}</span>
          <span className="text-xs text-muted-foreground">
            {PLACEHOLDER_USER.role}
          </span>
        </span>
      </button>
    </div>
  );
}

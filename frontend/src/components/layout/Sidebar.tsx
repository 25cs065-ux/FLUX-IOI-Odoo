"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { cn } from "cn";
import { NAV_ITEMS } from "@/lib/navigation";
import { signOut } from "./RoleGuard";

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: (value: boolean) => void;
  onMobileClose: () => void;
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onCollapse,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await signOut(router);
  }

  const sidebarContent = (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border px-3 shrink-0",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed && (
          <span className="text-base font-semibold tracking-tight text-sidebar-primary truncate">
            Brightloop
          </span>
        )}
        {/* Desktop collapse toggle */}
        <button
          onClick={() => onCollapse(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden lg:flex items-center justify-center rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </button>
        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          aria-label="Close navigation"
          className="flex lg:hidden items-center justify-center rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "justify-center px-0"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="shrink-0 border-t border-sidebar-border px-2 py-3">
        <button
          onClick={handleLogout}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            collapsed && "justify-center px-0"
          )}
          aria-label="Log out"
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — always in flow */}
      <aside className="hidden lg:flex shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          aria-hidden="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onMobileClose}
          />
          {/* Drawer */}
          <aside className="absolute inset-y-0 left-0 z-50 flex">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}

/** Standalone hamburger button rendered in the top navbar on mobile */
export function MobileMenuButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label="Open navigation"
      className="flex lg:hidden items-center justify-center rounded-md p-1.5 text-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
    >
      <Menu className="size-5" />
    </button>
  );
}

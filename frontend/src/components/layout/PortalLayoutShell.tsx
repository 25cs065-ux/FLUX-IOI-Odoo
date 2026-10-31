"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CreditCard,
  FileText,
  Wallet,
  UserCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { cn } from "cn";

// ---------------------------------------------------------------------------
// Portal navigation items — customer-facing only, no admin routes
// ---------------------------------------------------------------------------

const PORTAL_NAV = [
  { label: "Overview", href: "/portal", icon: LayoutDashboard },
  { label: "My Subscriptions", href: "/portal/subscriptions", icon: CreditCard },
  { label: "My Invoices", href: "/portal/invoices", icon: FileText },
  { label: "Payment History", href: "/portal/payments", icon: Wallet },
  { label: "My Profile", href: "/portal/profile", icon: UserCircle },
] as const;

// ---------------------------------------------------------------------------
// Shared sidebar content (used on desktop and mobile drawer)
// ---------------------------------------------------------------------------

interface SidebarContentProps {
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onMobileClose: () => void;
  isMobile: boolean;
}

function SidebarContent({
  collapsed,
  onCollapse,
  onMobileClose,
  isMobile,
}: SidebarContentProps) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200 ease-in-out",
        collapsed && !isMobile ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border px-3 shrink-0",
          collapsed && !isMobile ? "justify-center" : "justify-between"
        )}
      >
        {(!collapsed || isMobile) && (
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-sidebar-primary truncate">
              Brightloop
            </span>
            <span className="text-[10px] text-sidebar-foreground/50 font-medium uppercase tracking-widest">
              Customer Portal
            </span>
          </div>
        )}
        {isMobile ? (
          <button
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="flex items-center justify-center rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        ) : (
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
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {PORTAL_NAV.map((item) => {
          const isActive =
            item.href === "/portal"
              ? pathname === "/portal"
              : pathname.startsWith(item.href);
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
                collapsed && !isMobile && "justify-center px-0"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {(!collapsed || isMobile) && (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout placeholder */}
      <div className="shrink-0 border-t border-sidebar-border px-2 py-3">
        <button
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            collapsed && !isMobile && "justify-center px-0"
          )}
          aria-label="Log out"
        >
          <LogOut className="size-4 shrink-0" />
          {(!collapsed || isMobile) && <span>Log out</span>}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal layout shell
// ---------------------------------------------------------------------------

interface PortalLayoutShellProps {
  children: React.ReactNode;
}

export function PortalLayoutShell({ children }: PortalLayoutShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Derive page title from path
  const pageTitle =
    PORTAL_NAV.find(
      (n) =>
        n.href === "/portal"
          ? pathname === "/portal"
          : pathname.startsWith(n.href)
    )?.label ?? "Portal";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex shrink-0 h-screen sticky top-0">
        <SidebarContent
          collapsed={collapsed}
          onCollapse={setCollapsed}
          onMobileClose={() => {}}
          isMobile={false}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" aria-hidden="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 z-50 flex">
            <SidebarContent
              collapsed={false}
              onCollapse={() => {}}
              onMobileClose={() => setMobileOpen(false)}
              isMobile={true}
            />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 w-full items-center gap-3 border-b border-border bg-background px-4">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="flex lg:hidden items-center justify-center rounded-md p-1.5 text-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="flex-1 text-sm font-semibold text-foreground truncate">
            {pageTitle}
          </h1>
          {/* Demo customer badge */}
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <UserCircle className="size-3.5" aria-hidden="true" />
            Initech Ltd
            <span className="text-muted-foreground/50">· Demo</span>
          </span>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

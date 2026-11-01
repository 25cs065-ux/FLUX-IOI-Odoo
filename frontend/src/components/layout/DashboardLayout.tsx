"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopNavbar } from "./TopNavbar";
import { RoleGuard } from "./RoleGuard";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * DashboardLayout
 *
 * Composes the collapsible Sidebar and TopNavbar into a full-height shell.
 * Manages sidebar collapsed/mobile-open state at this level so both
 * Sidebar and TopNavbar can share it without prop-drilling through the
 * Next.js layout tree.
 *
 * Usage — wrap the (dashboard) route segment:
 *   <DashboardLayout>{children}</DashboardLayout>
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <RoleGuard>
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCollapse={setCollapsed}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Right column: navbar + scrollable content */}
      <div className="flex flex-1 flex-col min-w-0">
        <TopNavbar onMobileMenuOpen={() => setMobileOpen(true)} />

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
    </RoleGuard>
  );
}

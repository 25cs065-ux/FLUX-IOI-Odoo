import { DashboardLayout } from "@/components/layout";

/**
 * Dashboard route group layout.
 *
 * All pages under src/app/(dashboard)/ automatically receive
 * the Sidebar + TopNavbar shell through this file.
 * The route group "(dashboard)" is not part of the URL path.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}

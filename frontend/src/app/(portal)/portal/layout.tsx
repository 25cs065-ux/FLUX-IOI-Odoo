import { PortalLayoutShell } from "@/components/layout/PortalLayoutShell";

/**
 * Customer portal route group layout.
 * All pages under (portal)/portal/ automatically receive
 * the PortalLayoutShell. No admin navigation is exposed here.
 *
 * PortalLayoutShell's RoleGuard admits customers only; admin and staff are
 * sent to the dashboard. Data is scoped to the customer by the backend.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PortalLayoutShell>{children}</PortalLayoutShell>;
}

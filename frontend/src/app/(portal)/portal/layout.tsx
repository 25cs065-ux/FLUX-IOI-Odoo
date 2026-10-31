import { PortalLayoutShell } from "@/components/layout/PortalLayoutShell";

/**
 * Customer portal route group layout.
 * All pages under (portal)/portal/ automatically receive
 * the PortalLayoutShell. No admin navigation is exposed here.
 *
 * Supabase Auth session checking will be added in a later task.
 * For now, all portal pages are accessible with the demo customer.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PortalLayoutShell>{children}</PortalLayoutShell>;
}

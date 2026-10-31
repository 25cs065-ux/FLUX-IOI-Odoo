import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brightloop",
};

/**
 * Auth route group layout.
 * No sidebar or navbar — just a centred card on a muted background.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

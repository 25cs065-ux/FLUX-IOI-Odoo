import { redirect } from "next/navigation";

/**
 * Root page — proxy.ts handles session-based redirection.
 * Authenticated users reach /command-center (proxy allows it).
 * Unauthenticated users are redirected to /login by proxy.ts before
 * this page even renders, so this redirect is purely a fallback.
 */
export default function Home() {
  redirect("/command-center");
}

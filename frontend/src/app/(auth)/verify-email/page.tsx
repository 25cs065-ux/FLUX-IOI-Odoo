"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabase";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    "verifying"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Supabase handles the token from the confirmation link URL automatically
    // via detectSessionInUrl. We listen for the SIGNED_IN event that fires
    // once the token has been verified and a session is established.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        setStatus("success");
        // Redirect to dashboard after a short delay so the user sees the
        // success message.
        setTimeout(() => router.replace("/command-center"), 2000);
      } else if (event === "INITIAL_SESSION" && !session) {
        // No session was established from the URL — the link may be invalid
        // or already used.
        setStatus("error");
        setErrorMessage(
          "This confirmation link is invalid or has already been used."
        );
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (status === "success") {
    return (
      <div className="flex flex-col gap-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Email confirmed!
        </h1>
        <p className="text-sm text-muted-foreground">
          Your account is active. Redirecting you to the dashboard…
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Verification failed
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col gap-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 h-8 text-sm font-medium hover:bg-muted transition-colors"
          >
            Go to sign in
          </Link>
          <p className="text-center text-xs text-muted-foreground">
            Need a new link?{" "}
            <Link
              href="/register"
              className="font-medium text-foreground hover:underline"
            >
              Re-register
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // status === "verifying"
  return (
    <div className="flex flex-col gap-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Verifying your email
      </h1>
      <p className="text-sm text-muted-foreground">
        Please wait while we confirm your email address…
      </p>
    </div>
  );
}

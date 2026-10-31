"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Link from "next/link";

import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { resetPasswordSchema, type ResetPasswordForm } from "@/lib/validators";

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Supabase embeds the reset token in the URL hash when redirecting.
  // The SDK handles token extraction automatically via detectSessionInUrl.
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event, which fires after Supabase
    // has parsed the reset token from the URL and established a session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>();

  async function onSubmit(raw: ResetPasswordForm) {
    setServerError(null);

    const result = resetPasswordSchema.safeParse(raw);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof ResetPasswordForm | undefined;
        if (path) setError(path, { message: issue.message });
      });
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: result.data.password,
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    setDone(true);
    setTimeout(() => router.replace("/login"), 2500);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Password updated
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your password has been changed. Redirecting to sign in…
          </p>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Verifying your reset link…
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm text-center text-sm text-muted-foreground">
          If nothing happens,{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-foreground hover:underline"
          >
            request a new link
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a strong password for your account
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          {serverError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {serverError}
            </div>
          )}

          <FormField
            label="New password"
            required
            error={errors.password?.message}
            description="Must be at least 9 characters"
          >
            <input
              type="password"
              autoComplete="new-password"
              {...register("password")}
              className={inputCls}
              placeholder="••••••••••"
              aria-invalid={!!errors.password}
            />
          </FormField>

          <FormField
            label="Confirm new password"
            required
            error={errors.confirmPassword?.message}
          >
            <input
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
              className={inputCls}
              placeholder="••••••••••"
              aria-invalid={!!errors.confirmPassword}
            />
          </FormField>

          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Saving…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

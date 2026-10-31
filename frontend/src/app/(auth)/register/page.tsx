"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Link from "next/link";

import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { registerSchema, type RegisterForm } from "@/lib/validators";

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

export default function RegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>();

  async function onSubmit(raw: RegisterForm) {
    setServerError(null);

    const result = registerSchema.safeParse(raw);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof RegisterForm | undefined;
        if (path) setError(path, { message: issue.message });
      });
      return;
    }

    const { email, password } = result.data;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // emailRedirectTo is set so the confirmation link brings users back
        // to the verify-email page which then routes them to the right place.
        emailRedirectTo: `${window.location.origin}/verify-email`,
      },
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    // Supabase requires email confirmation — show the success state.
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Check your email
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to your email address. Click the link to
            activate your account.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm text-center text-sm text-muted-foreground">
          Didn&apos;t receive it?{" "}
          <Link
            href="/register"
            className="font-medium text-foreground hover:underline"
            onClick={() => setSuccess(false)}
          >
            Try again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start managing your subscriptions
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

          <FormField label="Email" required error={errors.email?.message}>
            <input
              type="email"
              autoComplete="email"
              {...register("email")}
              className={inputCls}
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
            />
          </FormField>

          <FormField
            label="Password"
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
            label="Confirm password"
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
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-foreground hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

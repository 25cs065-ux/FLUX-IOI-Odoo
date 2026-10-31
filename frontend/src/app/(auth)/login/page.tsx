"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Link from "next/link";

import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { loginSchema, type LoginForm } from "@/lib/validators";

// ---------------------------------------------------------------------------
// Input class — reused across auth pages for consistent styling
// ---------------------------------------------------------------------------
const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>();

  async function onSubmit(raw: LoginForm) {
    setServerError(null);

    // Client-side validation
    const result = loginSchema.safeParse(raw);
    if (!result.success) return; // RHF will show field errors

    const { email, password } = result.data;
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase returns generic messages for invalid credentials — keep them
      setServerError(error.message);
      return;
    }

    // Redirect to dashboard. The proxy will enforce role from there.
    router.replace("/command-center");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Sign in to Brightloop
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and password to continue
        </p>
      </div>

      {/* Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          {/* Server error */}
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

          <FormField label="Password" required error={errors.password?.message}>
            <input
              type="password"
              autoComplete="current-password"
              {...register("password")}
              className={inputCls}
              placeholder="••••••••••"
              aria-invalid={!!errors.password}
            />
          </FormField>

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>

      {/* Footer link */}
      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-foreground hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}

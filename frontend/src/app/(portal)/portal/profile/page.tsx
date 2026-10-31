"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { UserCircle, Save } from "lucide-react";

import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { apiClient, getAllPages } from "@/lib/api-client";
import { getSupabaseSession } from "@/lib/supabase-token";
import type { ApiCustomer } from "@/types/api";

const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z
    .string()
    .regex(/^[+\d\s\-()]{7,20}$/, "Please enter a valid phone number")
    .optional()
    .or(z.literal("")),
  address: z.string().max(255, "Address must be 255 characters or less"),
});

type ProfileForm = z.infer<typeof profileSchema>;

function toProfileForm(customer: ApiCustomer): ProfileForm {
  return {
    name: customer.name,
    email: customer.email,
    phone: customer.phone ?? "",
    address: customer.address ?? "",
  };
}

export default function PortalProfilePage() {
  const formId = useId();
  const [profile, setProfile] = useState<ApiCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileForm>({
    defaultValues: { name: "", email: "", phone: "", address: "" },
  });

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const session = await getSupabaseSession();
      if (!session) throw new Error("Your session has expired. Please sign in again.");
      const tokenOptions = { token: session.access_token };
      const customers = await getAllPages<ApiCustomer>("/customers/", 100, tokenOptions);
      const currentProfile = customers.find(
        (customer) => customer.auth_user_id === session.user.id
      );
      if (!currentProfile) throw new Error("No customer profile is linked to your account.");
      setProfile(currentProfile);
      reset(toProfileForm(currentProfile));
    } catch (err) {
      setProfile(null);
      setError(err instanceof Error ? err.message : "Failed to load your profile.");
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchProfile());
  }, [fetchProfile]);

  async function onValid(raw: ProfileForm) {
    if (!profile) return;
    setSaveSuccess(false);
    setError(null);

    const result = profileSchema.safeParse(raw);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof ProfileForm | undefined;
        if (path) setFieldError(path, { message: issue.message });
      });
      return;
    }

    setSaving(true);
    try {
      const session = await getSupabaseSession();
      if (!session) throw new Error("Your session has expired. Please sign in again.");
      const { data } = await apiClient.patch<ApiCustomer>(
        `/customers/${profile.id}`,
        {
          name: result.data.name,
          email: result.data.email,
          phone: result.data.phone || null,
          address: result.data.address || null,
        },
        { token: session.access_token }
      );
      if (!data) throw new Error("The updated customer profile was not returned.");
      setProfile(data);
      reset(toProfileForm(data));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update your profile.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Profile</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your account details
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className="shrink-0 underline" onClick={() => void fetchProfile()}>
            Retry
          </button>
        </div>
      )}

      {profile && (
        <>
          <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-lg font-semibold text-sidebar-primary-foreground"
              aria-hidden="true"
            >
              {profile.name
                .split(" ")
                .map((word) => word[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div>
              <p className="font-semibold text-foreground">{profile.name}</p>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Customer since {formatDate(profile.created_at)}
              </p>
            </div>
          </div>

          <form
            id={formId}
            onSubmit={handleSubmit(onValid)}
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-sm font-semibold text-foreground">Account details</h2>

            <FormField label="Full name" required error={errors.name?.message}>
              <input
                type="text"
                {...register("name")}
                className={inputCls}
                placeholder="Your full name"
                aria-invalid={!!errors.name}
              />
            </FormField>

            <FormField label="Email address" required error={errors.email?.message}>
              <input
                type="email"
                {...register("email")}
                className={inputCls}
                placeholder="you@example.com"
                aria-invalid={!!errors.email}
              />
            </FormField>

            <FormField
              label="Phone number"
              error={errors.phone?.message}
              description="Optional — e.g. +91 98765 43210"
            >
              <input
                type="tel"
                {...register("phone")}
                className={inputCls}
                placeholder="+91 98765 43210"
                aria-invalid={!!errors.phone}
              />
            </FormField>

            <FormField label="Address" error={errors.address?.message}>
              <input
                type="text"
                {...register("address")}
                className={inputCls}
                placeholder="Billing or physical address"
                aria-invalid={!!errors.address}
              />
            </FormField>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">Customer ID</span>
              <span className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                {profile.id}
              </span>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" size="sm" disabled={!isDirty || saving || loading}>
                <Save className="size-3.5" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {saveSuccess && (
                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                  Changes saved
                </span>
              )}
            </div>
          </form>
        </>
      )}

      {loading && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading your profile…
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Account security</h2>
        <p className="text-sm text-muted-foreground">
          Password and authentication settings are managed through Supabase Auth.
        </p>
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <UserCircle className="size-3.5 shrink-0" />
          Your account is authenticated with Supabase.
        </div>
      </div>
    </div>
  );
}

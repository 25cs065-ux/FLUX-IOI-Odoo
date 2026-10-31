"use client";

import { useState, useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { UserCircle, Save } from "lucide-react";

import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { DEMO_CUSTOMER, type DemoCustomer } from "@/mocks/demo-customer";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z
    .string()
    .regex(
      /^[+\d\s\-()]{7,20}$/,
      "Please enter a valid phone number"
    )
    .optional()
    .or(z.literal("")),
  company: z.string().min(1, "Company name is required"),
});

type ProfileForm = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortalProfilePage() {
  const formId = useId();
  const [savedProfile, setSavedProfile] = useState<DemoCustomer>(DEMO_CUSTOMER);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileForm>({
    defaultValues: {
      name: savedProfile.name,
      email: savedProfile.email,
      phone: savedProfile.phone ?? "",
      company: savedProfile.company,
    },
  });

  function onValid(raw: ProfileForm) {
    // Validate with Zod manually (no @hookform/resolvers needed)
    const result = profileSchema.safeParse(raw);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof ProfileForm | undefined;
        if (path) setError(path, { message: issue.message });
      });
      return;
    }

    // Update local mock state — no backend call
    const updated: DemoCustomer = {
      ...savedProfile,
      name: result.data.name,
      email: result.data.email,
      phone: result.data.phone || null,
      company: result.data.company,
    };
    setSavedProfile(updated);
    reset(result.data);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  const inputCls =
    "h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Profile</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your account details
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          Demo — saved locally only
        </span>
      </div>

      {/* Avatar + account info */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <div
          className="flex size-14 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-lg font-semibold shrink-0"
          aria-hidden="true"
        >
          {savedProfile.name
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div>
          <p className="font-semibold text-foreground">{savedProfile.name}</p>
          <p className="text-sm text-muted-foreground">{savedProfile.email}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customer since {formatDate(savedProfile.createdAt)}
          </p>
        </div>
      </div>

      {/* Profile form */}
      <form
        id={formId}
        onSubmit={handleSubmit(onValid)}
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
      >
        <h2 className="text-sm font-semibold text-foreground">
          Account details
        </h2>

        <FormField
          label="Full name"
          required
          error={errors.name?.message}
        >
          <input
            type="text"
            {...register("name")}
            className={inputCls}
            placeholder="Your full name"
            aria-invalid={!!errors.name}
          />
        </FormField>

        <FormField
          label="Email address"
          required
          error={errors.email?.message}
        >
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

        <FormField
          label="Company"
          required
          error={errors.company?.message}
        >
          <input
            type="text"
            {...register("company")}
            className={inputCls}
            placeholder="Company name"
            aria-invalid={!!errors.company}
          />
        </FormField>

        {/* Read-only customer ID */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">
            Customer ID
          </span>
          <span className="font-mono text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
            {savedProfile.id}
          </span>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" disabled={!isDirty}>
            <Save className="size-3.5" />
            Save changes
          </Button>
          {saveSuccess && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
              ✓ Changes saved (demo only)
            </span>
          )}
        </div>
      </form>

      {/* Account info */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Account security
        </h2>
        <p className="text-sm text-muted-foreground">
          Password and two-factor authentication settings will be available
          once Supabase Auth is integrated.
        </p>
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <UserCircle className="size-3.5 shrink-0" />
          Authentication is not yet enabled — this is a demo session.
        </div>
      </div>
    </div>
  );
}

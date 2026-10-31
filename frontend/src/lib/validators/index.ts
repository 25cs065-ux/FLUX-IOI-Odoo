// ---------------------------------------------------------------------------
// Shared Zod validators
//
// Centralised schemas used by auth pages and API forms.
// Mirrors the backend constraints from the API handoff document.
// ---------------------------------------------------------------------------

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Auth validators
// ---------------------------------------------------------------------------

/** Email field — reused in login, register, forgot-password. */
const emailField = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .trim();

/**
 * Password field.
 * The test plan specifies passwords LONGER THAN 8 characters.
 * Supabase enforces this server-side; we mirror it client-side.
 */
const passwordField = z
  .string()
  .min(9, "Password must be at least 9 characters")
  .max(72, "Password must be 72 characters or fewer");

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});

export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    email: emailField,
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterForm = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------------------
// Payment validator (moved from payments/page.tsx)
// ---------------------------------------------------------------------------

export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Please select an invoice"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount e.g. 49.00"),
  method: z.enum(
    ["bank_transfer", "credit_card", "upi", "cash", "cheque", "other"] as const,
    { error: "Please select a payment method" }
  ),
  status: z.enum(["pending", "completed", "failed"] as const, {
    error: "Please select a status",
  }),
  date: z.string().min(1, "Date is required"),
  reference: z.string().optional(),
  notes: z.string().max(500, "Notes must be 500 characters or less").optional(),
});

export type RecordPaymentForm = z.infer<typeof recordPaymentSchema>;

// ---------------------------------------------------------------------------
// Profile validator (moved from portal/profile/page.tsx)
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: emailField,
  phone: z
    .string()
    .regex(/^[+\d\s\-()]{7,20}$/, "Please enter a valid phone number")
    .optional()
    .or(z.literal("")),
  company: z.string().min(1, "Company name is required"),
});

export type ProfileForm = z.infer<typeof profileSchema>;

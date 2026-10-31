// ---------------------------------------------------------------------------
// Backend API response types
//
// These types mirror the FastAPI/Pydantic models from the backend.
// Key differences from the mock types:
//   - IDs are UUIDs (string)
//   - Money fields are decimal strings e.g. "159.30" (NOT integer cents)
//   - Status enums match backend values exactly
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface StatusHistory {
  id: string;
  subscription_id: string;
  changed_at: string | null;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | "draft"
  | "quotation"
  | "confirmed"
  | "active"
  | "paused"
  | "closed";

export interface ApiSubscriptionSummary {
  id: string;
  subscription_number: string;
  quotation_number: string | null;
  customer_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  quantity: string;
  start_date: string;
  end_date: string | null;
  trial_end_date: string | null;
  next_billing_date: string | null;
  confirmed_at: string | null;
  paused_at: string | null;
  closed_at: string | null;
  pause_reason: string | null;
  close_reason: string | null;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  currency: string;
  auto_renew: boolean;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ApiSubscriptionLine {
  id: string;
  subscription_id: string;
  product_id: string | null;
  variant_id: string | null;
  sequence: number;
  description: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  discount_amount: string;
  tax_id: string | null;
  tax_amount: string;
  subtotal: string;
  line_total: string;
}

export interface ApiSubscription extends ApiSubscriptionSummary {
  lines: ApiSubscriptionLine[];
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partial"
  | "paid"
  | "overdue"
  | "void"
  | "cancelled";

export interface ApiInvoiceSummary {
  id: string;
  invoice_number: string;
  customer_id: string;
  subscription_id: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  amount_paid: string;
  amount_due: string;
  currency: string;
  notes: string | null;
  terms_and_conditions: string | null;
  paid_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ApiInvoiceLine {
  id: string;
  invoice_id: string;
  subscription_line_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  sequence: number;
  description: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  discount_amount: string;
  tax_id: string | null;
  tax_name: string | null;
  tax_rate: string | null;
  tax_amount: string;
  subtotal: string;
  line_total: string;
}

export interface ApiInvoice extends ApiInvoiceSummary {
  lines: ApiInvoiceLine[];
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "refunded"
  | "partially_refunded";

export type ApiPaymentMethod =
  | "bank_transfer"
  | "credit_card"
  | "upi"
  | "cash"
  | "cheque"
  | "other";

export interface ApiPayment {
  id: string;
  invoice_id: string;
  customer_id: string;
  status: PaymentStatus;
  method: ApiPaymentMethod;
  amount: string;
  refunded_amount: string;
  currency: string;
  payment_date: string;
  payment_reference: string;
  notes: string | null;
  refunded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatePaymentBody {
  invoice_id: string;
  amount: string;
  method: ApiPaymentMethod;
  status: "pending" | "completed";
  payment_date?: string;
  payment_reference?: string;
  notes?: string;
}

export interface PaymentResult {
  payment: ApiPayment;
  invoice: ApiInvoiceSummary;
}

export interface ApiPlan {
  id: string;
  name: string;
  interval: "daily" | "weekly" | "monthly" | "yearly";
  price: string | number;
  min_quantity: number;
  start_date: string | null;
  end_date: string | null;
  auto_close: boolean;
  closable_early: boolean;
  pausable: boolean;
  renewable: boolean;
  is_active: boolean;
  created_at: string | null;
}

export interface ApiVariant {
  id: string;
  product_id: string;
  name: string;
  sku_suffix: string | null;
  extra_price: string | number;
  is_active: boolean;
  base_product_price: string | number;
  final_price: string | number;
  created_at: string | null;
}

export interface ApiCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  auth_user_id: string | null;
  role: "admin" | "staff" | "customer" | string;
  is_active: boolean;
  created_at: string | null;
}

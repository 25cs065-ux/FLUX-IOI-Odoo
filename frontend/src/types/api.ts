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
  changed_at: string; // ISO 8601
  from_status: string | null;
  to_status: string;
  changed_by: string | null; // user id or "system"
  note: string | null;
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

export interface ApiSubscription {
  id: string; // UUID
  reference: string;
  customer_id: string;
  customer_name: string;
  plan_id: string;
  plan_name: string;
  status: SubscriptionStatus;
  /** Decimal string e.g. "159.30" */
  amount: string;
  currency: string;
  billing_interval: string; // e.g. "monthly", "annual"
  start_date: string; // ISO 8601 date
  next_billing_date: string | null;
  cancelled_date: string | null;
  created_at: string;
  updated_at: string;
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

export interface ApiInvoice {
  id: string; // UUID
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  subscription_id: string | null;
  status: InvoiceStatus;
  /** Decimal string e.g. "500.00" */
  total_amount: string;
  /** Decimal string e.g. "250.00" */
  paid_amount: string;
  currency: string;
  issued_date: string | null; // ISO 8601 date
  due_date: string | null;
  paid_date: string | null;
  created_at: string;
  updated_at: string;
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
  id: string; // UUID
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  status: PaymentStatus;
  method: ApiPaymentMethod;
  /** Decimal string e.g. "49.00" */
  amount: string;
  currency: string;
  payment_date: string; // ISO 8601 date
  payment_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Body for POST /payments */
export interface CreatePaymentBody {
  invoice_id: string;
  /** Decimal string e.g. "50.00" */
  amount: string;
  method: ApiPaymentMethod;
  /** Backend status at creation time — typically "completed" */
  status: PaymentStatus;
  payment_date: string;
  payment_reference?: string;
  notes?: string;
}

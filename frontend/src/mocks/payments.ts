// ---------------------------------------------------------------------------
// Mock Payments
//
// Realistic sample data for the Payments list view.
// Replace the array with a real API response when the backend is ready.
// ---------------------------------------------------------------------------

import type { StatusValue } from "@/components/shared/StatusBadge";

/**
 * Payment method enum matching the backend exactly.
 * Maps to ApiPaymentMethod in src/types/api.ts.
 */
export type PaymentMethod =
  | "bank_transfer"
  | "credit_card"
  | "upi"
  | "cash"
  | "cheque"
  | "other";

export interface MockPayment {
  id: string;
  /** Internal payment reference. */
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  status: StatusValue;
  method: PaymentMethod;
  /** ISO 8601 date string. */
  date: string;
  /** Amount received in minor units (cents). */
  amountCents: number;
  currency: string;
  /** Last 4 digits for card payments, masked account for bank. Null for others. */
  maskedAccount: string | null;
  /** Gateway transaction reference (e.g. Stripe charge ID). */
  gatewayReference: string | null;
}

export const MOCK_PAYMENTS: MockPayment[] = [
  {
    id: "pay_001",
    reference: "PAY-2026-0001",
    invoiceId: "inv_001",
    invoiceNumber: "INV-2026-0001",
    customerId: "cus_001",
    customerName: "Acme Corp",
    status: "completed",
    method: "credit_card",
    date: "2026-10-10",
    amountCents: 4900,
    currency: "INR",
    maskedAccount: "•••• 4242",
    gatewayReference: "ch_3QA1XxLkdIwHu7ix0FhK1234",
  },
  {
    id: "pay_002",
    reference: "PAY-2026-0002",
    invoiceId: "inv_002",
    invoiceNumber: "INV-2026-0002",
    customerId: "cus_002",
    customerName: "Globex Solutions",
    status: "completed",
    method: "upi",
    date: "2026-10-14",
    amountCents: 1900,
    currency: "INR",
    maskedAccount: "user@okaxis",
    gatewayReference: "upi_3QB2YyMleLxIv8jy1GiL5678",
  },
  {
    id: "pay_003",
    reference: "PAY-2026-0003",
    invoiceId: "inv_005",
    invoiceNumber: "INV-2026-0005",
    customerId: "cus_006",
    customerName: "Wayne Enterprises",
    status: "completed",
    method: "bank_transfer",
    date: "2026-05-12",
    amountCents: 29900,
    currency: "INR",
    maskedAccount: "•••• 9101",
    gatewayReference: "bt_20260512_wayne_29900",
  },
  {
    id: "pay_004",
    reference: "PAY-2026-0004",
    invoiceId: "inv_004",
    invoiceNumber: "INV-2026-0004",
    customerId: "cus_007",
    customerName: "Oscorp Technologies",
    status: "failed",
    method: "credit_card",
    date: "2026-10-11",
    amountCents: 4900,
    currency: "INR",
    maskedAccount: "•••• 0000",
    gatewayReference: "ch_3QC3ZzNmfMyJw9kz2HjM9012",
  },
  {
    id: "pay_005",
    reference: "PAY-2026-0005",
    invoiceId: "inv_003",
    invoiceNumber: "INV-2026-0003",
    customerId: "cus_003",
    customerName: "Initech Ltd",
    status: "pending",
    method: "bank_transfer",
    date: "2026-10-25",
    amountCents: 29900,
    currency: "INR",
    maskedAccount: "•••• 3344",
    gatewayReference: null,
  },
  {
    id: "pay_006",
    reference: "PAY-2026-0006",
    invoiceId: "inv_006",
    invoiceNumber: "INV-2026-0006",
    customerId: "cus_008",
    customerName: "Hooli Inc",
    status: "pending",
    method: "credit_card",
    date: "2026-10-28",
    amountCents: 1900,
    currency: "INR",
    maskedAccount: "•••• 1122",
    gatewayReference: null,
  },
];

// ---------------------------------------------------------------------------
// Mock Invoices
//
// Realistic sample data for the Invoices list view.
// Replace the array with a real API response when the backend is ready.
// ---------------------------------------------------------------------------

import type { StatusValue } from "@/components/shared/StatusBadge";

export interface MockInvoice {
  id: string;
  /** Human-readable invoice number shown on documents. */
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  subscriptionId: string | null;
  status: StatusValue;
  /** ISO 8601 date string. */
  issuedDate: string;
  /** ISO 8601 date string. */
  dueDate: string;
  /** ISO 8601 date string, or null if not yet paid. */
  paidDate: string | null;
  /** Total amount in minor units (cents). */
  totalCents: number;
  /** Amount already received, in minor units. */
  paidCents: number;
  currency: string;
}

export const MOCK_INVOICES: MockInvoice[] = [
  {
    id: "inv_001",
    invoiceNumber: "INV-2026-0001",
    customerId: "cus_001",
    customerName: "Acme Corp",
    subscriptionId: "sub_001",
    status: "paid",
    issuedDate: "2026-10-01",
    dueDate: "2026-10-15",
    paidDate: "2026-10-10",
    totalCents: 4900,
    paidCents: 4900,
    currency: "USD",
  },
  {
    id: "inv_002",
    invoiceNumber: "INV-2026-0002",
    customerId: "cus_002",
    customerName: "Globex Solutions",
    subscriptionId: "sub_002",
    status: "paid",
    issuedDate: "2026-10-01",
    dueDate: "2026-10-15",
    paidDate: "2026-10-14",
    totalCents: 1900,
    paidCents: 1900,
    currency: "USD",
  },
  {
    id: "inv_003",
    invoiceNumber: "INV-2026-0003",
    customerId: "cus_003",
    customerName: "Initech Ltd",
    subscriptionId: "sub_003",
    status: "pending",
    issuedDate: "2026-10-20",
    dueDate: "2026-11-20",
    paidDate: null,
    totalCents: 29900,
    paidCents: 0,
    currency: "USD",
  },
  {
    id: "inv_004",
    invoiceNumber: "INV-2026-0004",
    customerId: "cus_007",
    customerName: "Oscorp Technologies",
    subscriptionId: "sub_007",
    status: "overdue",
    issuedDate: "2026-09-10",
    dueDate: "2026-10-10",
    paidDate: null,
    totalCents: 4900,
    paidCents: 0,
    currency: "USD",
  },
  {
    id: "inv_005",
    invoiceNumber: "INV-2026-0005",
    customerId: "cus_006",
    customerName: "Wayne Enterprises",
    subscriptionId: "sub_006",
    status: "paid",
    issuedDate: "2026-05-01",
    dueDate: "2026-05-15",
    paidDate: "2026-05-12",
    totalCents: 29900,
    paidCents: 29900,
    currency: "USD",
  },
  {
    id: "inv_006",
    invoiceNumber: "INV-2026-0006",
    customerId: "cus_008",
    customerName: "Hooli Inc",
    subscriptionId: "sub_008",
    status: "pending",
    issuedDate: "2026-10-15",
    dueDate: "2026-11-15",
    paidDate: null,
    totalCents: 1900,
    paidCents: 0,
    currency: "USD",
  },
  {
    id: "inv_007",
    invoiceNumber: "INV-2026-0007",
    customerId: "cus_004",
    customerName: "Umbrella Holdings",
    subscriptionId: "sub_004",
    status: "draft",
    issuedDate: "2026-10-28",
    dueDate: "2026-11-28",
    paidDate: null,
    totalCents: 4900,
    paidCents: 0,
    currency: "USD",
  },
  {
    id: "inv_008",
    invoiceNumber: "INV-2026-0008",
    customerId: "cus_005",
    customerName: "Stark Industries",
    subscriptionId: "sub_005",
    status: "cancelled",
    issuedDate: "2026-09-01",
    dueDate: "2026-09-15",
    paidDate: null,
    totalCents: 1900,
    paidCents: 0,
    currency: "USD",
  },
];

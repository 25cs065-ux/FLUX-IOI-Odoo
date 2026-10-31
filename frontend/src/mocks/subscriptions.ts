// ---------------------------------------------------------------------------
// Mock Subscriptions
//
// Realistic sample data for the Subscriptions list view.
// Replace the array with a real API response when the backend is ready.
// ---------------------------------------------------------------------------

import type { StatusValue } from "@/components/shared/StatusBadge";

export interface MockSubscription {
  id: string;
  /** Internal reference shown to staff. */
  reference: string;
  /** Customer display name — fictional only. */
  customerName: string;
  customerId: string;
  planName: string;
  planId: string;
  status: StatusValue;
  /** ISO 8601 date string. */
  startDate: string;
  /** ISO 8601 date string, or null if open-ended. */
  nextBillingDate: string | null;
  /** ISO 8601 date string, or null if still active. */
  cancelledDate: string | null;
  /** Recurring amount in the currency's minor units (cents). */
  amountCents: number;
  currency: string;
  billingInterval: "monthly" | "quarterly" | "annual";
}

export const MOCK_SUBSCRIPTIONS: MockSubscription[] = [
  {
    id: "sub_001",
    reference: "SUB-2024-0001",
    customerName: "Acme Corp",
    customerId: "cus_001",
    planName: "Growth",
    planId: "plan_growth",
    status: "active",
    startDate: "2024-01-15",
    nextBillingDate: "2026-11-15",
    cancelledDate: null,
    amountCents: 4900,
    currency: "USD",
    billingInterval: "monthly",
  },
  {
    id: "sub_002",
    reference: "SUB-2024-0002",
    customerName: "Globex Solutions",
    customerId: "cus_002",
    planName: "Starter",
    planId: "plan_starter",
    status: "active",
    startDate: "2024-03-01",
    nextBillingDate: "2026-11-01",
    cancelledDate: null,
    amountCents: 1900,
    currency: "USD",
    billingInterval: "monthly",
  },
  {
    id: "sub_003",
    reference: "SUB-2024-0003",
    customerName: "Initech Ltd",
    customerId: "cus_003",
    planName: "Enterprise",
    planId: "plan_enterprise",
    status: "active",
    startDate: "2023-07-20",
    nextBillingDate: "2026-12-20",
    cancelledDate: null,
    amountCents: 29900,
    currency: "USD",
    billingInterval: "annual",
  },
  {
    id: "sub_004",
    reference: "SUB-2024-0004",
    customerName: "Umbrella Holdings",
    customerId: "cus_004",
    planName: "Growth",
    planId: "plan_growth",
    status: "pending",
    startDate: "2026-10-28",
    nextBillingDate: "2026-11-28",
    cancelledDate: null,
    amountCents: 4900,
    currency: "USD",
    billingInterval: "monthly",
  },
  {
    id: "sub_005",
    reference: "SUB-2024-0005",
    customerName: "Stark Industries",
    customerId: "cus_005",
    planName: "Starter",
    planId: "plan_starter",
    status: "cancelled",
    startDate: "2024-02-10",
    nextBillingDate: null,
    cancelledDate: "2026-09-30",
    amountCents: 1900,
    currency: "USD",
    billingInterval: "monthly",
  },
  {
    id: "sub_006",
    reference: "SUB-2024-0006",
    customerName: "Wayne Enterprises",
    customerId: "cus_006",
    planName: "Enterprise",
    planId: "plan_enterprise",
    status: "active",
    startDate: "2024-05-01",
    nextBillingDate: "2027-05-01",
    cancelledDate: null,
    amountCents: 29900,
    currency: "USD",
    billingInterval: "annual",
  },
  {
    id: "sub_007",
    reference: "SUB-2025-0007",
    customerName: "Oscorp Technologies",
    customerId: "cus_007",
    planName: "Growth",
    planId: "plan_growth",
    status: "overdue",
    startDate: "2025-01-10",
    nextBillingDate: "2026-10-10",
    cancelledDate: null,
    amountCents: 4900,
    currency: "USD",
    billingInterval: "monthly",
  },
  {
    id: "sub_008",
    reference: "SUB-2025-0008",
    customerName: "Hooli Inc",
    customerId: "cus_008",
    planName: "Starter",
    planId: "plan_starter",
    status: "active",
    startDate: "2025-04-15",
    nextBillingDate: "2026-11-15",
    cancelledDate: null,
    amountCents: 1900,
    currency: "USD",
    billingInterval: "monthly",
  },
];

// ---------------------------------------------------------------------------
// Mock Command Center Data
//
// Stat card figures and revenue chart data for the dashboard overview.
// Replace with real API responses when the backend is ready.
// ---------------------------------------------------------------------------

import type { StatCardTrend } from "@/components/shared/StatCard";

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

export interface DashboardStat {
  id: string;
  title: string;
  value: string;
  description?: string;
  trend?: StatCardTrend;
}

export const MOCK_DASHBOARD_STATS: DashboardStat[] = [
  {
    id: "stat_mrr",
    title: "Monthly Recurring Revenue",
    value: "$74,300",
    description: "Combined MRR across all active subscriptions",
    trend: { direction: "up", label: "+8.4% vs last month" },
  },
  {
    id: "stat_active_subs",
    title: "Active Subscriptions",
    value: "6",
    description: "Of 8 total subscriptions",
    trend: { direction: "up", label: "+2 this month" },
  },
  {
    id: "stat_outstanding",
    title: "Outstanding Invoices",
    value: "$34,800",
    description: "Across 3 unpaid invoices",
    trend: { direction: "down", label: "−12% vs last month" },
  },
  {
    id: "stat_overdue",
    title: "Overdue Invoices",
    value: "1",
    description: "$49.00 — 21 days past due",
    trend: { direction: "neutral", label: "Unchanged" },
  },
  {
    id: "stat_churn",
    title: "Churn Rate",
    value: "2.1%",
    description: "30-day rolling average",
    trend: { direction: "down", label: "−0.4 pp vs last month" },
  },
  {
    id: "stat_new_customers",
    title: "New Customers",
    value: "3",
    description: "Signed up this month",
    trend: { direction: "up", label: "+3 vs last month" },
  },
];

// ---------------------------------------------------------------------------
// Revenue chart
//
// Monthly revenue for the past 12 months (amounts in USD cents).
// Each entry maps to one data point on the chart.
// ---------------------------------------------------------------------------

export interface RevenueDataPoint {
  /** "MMM YYYY" label for the chart x-axis, e.g. "Nov 2025". */
  month: string;
  /** Total revenue collected (in cents). */
  revenueCents: number;
  /** New MRR added that month (in cents). */
  newMrrCents: number;
  /** MRR churned that month (in cents, positive value). */
  churnedMrrCents: number;
}

export const MOCK_REVENUE_CHART: RevenueDataPoint[] = [
  { month: "Nov 2025", revenueCents: 4120000, newMrrCents: 490000, churnedMrrCents: 190000 },
  { month: "Dec 2025", revenueCents: 4870000, newMrrCents: 990000, churnedMrrCents: 0 },
  { month: "Jan 2026", revenueCents: 5390000, newMrrCents: 520000, churnedMrrCents: 190000 },
  { month: "Feb 2026", revenueCents: 5590000, newMrrCents: 490000, churnedMrrCents: 0 },
  { month: "Mar 2026", revenueCents: 6100000, newMrrCents: 510000, churnedMrrCents: 190000 },
  { month: "Apr 2026", revenueCents: 6380000, newMrrCents: 490000, churnedMrrCents: 0 },
  { month: "May 2026", revenueCents: 7280000, newMrrCents: 2990000, churnedMrrCents: 190000 },
  { month: "Jun 2026", revenueCents: 7070000, newMrrCents: 190000, churnedMrrCents: 490000 },
  { month: "Jul 2026", revenueCents: 7260000, newMrrCents: 490000, churnedMrrCents: 190000 },
  { month: "Aug 2026", revenueCents: 7430000, newMrrCents: 490000, churnedMrrCents: 0 },
  { month: "Sep 2026", revenueCents: 6940000, newMrrCents: 190000, churnedMrrCents: 1900000 },
  { month: "Oct 2026", revenueCents: 7430000, newMrrCents: 490000, churnedMrrCents: 0 },
];

// ---------------------------------------------------------------------------
// Subscription status breakdown (for a pie / donut chart)
// ---------------------------------------------------------------------------

export interface SubscriptionStatusBreakdown {
  status: string;
  count: number;
}

export const MOCK_SUBSCRIPTION_STATUS_BREAKDOWN: SubscriptionStatusBreakdown[] =
  [
    { status: "Active", count: 6 },
    { status: "Pending", count: 1 },
    { status: "Overdue", count: 1 },
    { status: "Cancelled", count: 1 },
  ];

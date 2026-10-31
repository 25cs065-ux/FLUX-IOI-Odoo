"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  CreditCard,
  TrendingUp,
  FileText,
  AlertCircle,
  Users,
  BarChart2,
  RefreshCw,
} from "lucide-react";

import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { formatDate, formatInrCents, formatInrCentsFull } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits, multiplyMinorUnits } from "@/lib/money";
import { apiClient, clearApiCache, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type {
  ApiCustomer,
  ApiInvoiceSummary,
  ApiPayment,
  ApiPlan,
  ApiSubscriptionSummary,
  SubscriptionStatus,
} from "@/types/api";

type Period = 3 | 6 | 12;

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
];

const STATUS_COLOURS: Record<SubscriptionStatus, string> = {
  draft: "#94a3b8",
  quotation: "#eab308",
  confirmed: "#60a5fa",
  active: "#22c55e",
  paused: "#38bdf8",
  closed: "#ef4444",
};

// Monthly series for the charts, in minor units (paise), from live records:
//   revenue     net completed payments, by payment date
//   newMrr      monthly value of subscriptions that started that month
//   churnedMrr  monthly value of subscriptions closed that month
interface ChartMonth {
  key: string; // "YYYY-MM"
  revenue: bigint;
  newMrr: bigint;
  churnedMrr: bigint;
}

interface ChartPoint {
  key: string;
  month: string; // "Oct 2026"
  Revenue: number;
  "New MRR": number;
  "Churned MRR": number;
}

interface PaymentActivity {
  id: string;
  reference: string;
  customer: string;
  amount: string;
  currency: string;
  date: string;
}

interface DashboardData {
  activeCount: number;
  subscriptionCount: number;
  mrr: bigint;
  arr: bigint;
  outstanding: bigint;
  overdue: bigint;
  overdueCount: number;
  collected: bigint;
  customerCount: number;
  subscriptionStatuses: { status: SubscriptionStatus; count: number }[];
  months: ChartMonth[];
  recentPayments: PaymentActivity[];
}

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}

function RevenueTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums">{formatInrCentsFull(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function toMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

/** The last `count` calendar months ending with the current month, oldest first ("YYYY-MM"). */
function lastMonthKeys(count: number, today = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth() - (count - 1 - i), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** One point per calendar month in the window; months without records are zero. */
function buildMonthWindow(months: ChartMonth[], count: number): ChartPoint[] {
  const byKey = new Map(months.map((month) => [month.key, month]));
  return lastMonthKeys(count).map((key) => {
    const month = byKey.get(key);
    return {
      key,
      month: toMonthLabel(key),
      Revenue: Number(month?.revenue ?? 0n),
      "New MRR": Number(month?.newMrr ?? 0n),
      "Churned MRR": Number(month?.churnedMrr ?? 0n),
    };
  });
}

function normalizeMrr(amount: bigint, interval: ApiPlan["interval"]): bigint {
  switch (interval) {
    case "daily":
      return amount * 30n;
    case "weekly":
      return multiplyMinorUnits(amount, 433n, 100n);
    case "monthly":
      return amount;
    case "yearly":
      return multiplyMinorUnits(amount, 1n, 12n);
  }
}

function calculateDashboard(
  activeSubscriptions: ApiSubscriptionSummary[],
  subscriptions: ApiSubscriptionSummary[],
  invoices: ApiInvoiceSummary[],
  overdueInvoices: ApiInvoiceSummary[],
  payments: ApiPayment[],
  customers: ApiCustomer[],
  plans: ApiPlan[]
): DashboardData {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const mrr = activeSubscriptions.reduce((total, subscription) => {
    const plan = plansById.get(subscription.plan_id);
    if (!plan) throw new Error(`Billing interval is unavailable for plan ${subscription.plan_id}.`);
    return total + normalizeMrr(decimalToMinorUnits(subscription.total_amount), plan.interval);
  }, 0n);

  const outstanding = invoices
    .filter((invoice) => ["sent", "partial", "overdue"].includes(invoice.status))
    .reduce((total, invoice) => total + decimalToMinorUnits(invoice.amount_due), 0n);
  const overdue = overdueInvoices.reduce(
    (total, invoice) => total + decimalToMinorUnits(invoice.amount_due),
    0n
  );
  const collected = payments
    .filter((payment) => payment.status === "completed" || payment.status === "partially_refunded")
    .reduce(
      (total, payment) =>
        total + decimalToMinorUnits(payment.amount) - decimalToMinorUnits(payment.refunded_amount),
      0n
    );

  const statusCounts = new Map<SubscriptionStatus, number>();
  for (const subscription of subscriptions) {
    statusCounts.set(subscription.status, (statusCounts.get(subscription.status) ?? 0) + 1);
  }

  const months = new Map<string, ChartMonth>();
  const monthEntry = (key: string) => {
    const entry = months.get(key) ?? { key, revenue: 0n, newMrr: 0n, churnedMrr: 0n };
    months.set(key, entry);
    return entry;
  };
  const monthlyValue = (subscription: ApiSubscriptionSummary) => {
    const plan = plansById.get(subscription.plan_id);
    return plan ? normalizeMrr(decimalToMinorUnits(subscription.total_amount), plan.interval) : 0n;
  };
  for (const payment of payments) {
    monthEntry(payment.payment_date.slice(0, 7)).revenue +=
      decimalToMinorUnits(payment.amount) - decimalToMinorUnits(payment.refunded_amount);
  }
  for (const subscription of subscriptions) {
    // Subscriptions that went live (drafts, quotations and confirmed-but-not-started are excluded).
    if (["active", "paused", "closed"].includes(subscription.status)) {
      monthEntry(subscription.start_date.slice(0, 7)).newMrr += monthlyValue(subscription);
    }
    if (subscription.status === "closed" && subscription.closed_at) {
      monthEntry(subscription.closed_at.slice(0, 7)).churnedMrr += monthlyValue(subscription);
    }
  }

  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const recentPayments = [...payments]
    .sort((left, right) => right.payment_date.localeCompare(left.payment_date))
    .slice(0, 5)
    .map((payment) => ({
      id: payment.id,
      reference: payment.payment_reference,
      customer: customersById.get(payment.customer_id)?.name ?? payment.customer_id,
      amount: payment.amount,
      currency: payment.currency,
      date: payment.payment_date,
    }));

  return {
    activeCount: activeSubscriptions.length,
    subscriptionCount: subscriptions.length,
    mrr,
    arr: mrr * 12n,
    outstanding,
    overdue,
    overdueCount: overdueInvoices.length,
    collected,
    customerCount: customers.filter((customer) => customer.role === "customer").length,
    subscriptionStatuses: [...statusCounts].map(([status, count]) => ({ status, count })),
    months: [...months.values()],
    recentPayments,
  };
}

export default function CommandCenterPage() {
  const [period, setPeriod] = useState<Period>(12);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setError(null);
      const options = token ? { token } : undefined;
      // One request per list; the status subsets are filtered locally (and the
      // full lists are shared with other pages through the API client's cache).
      const [subscriptions, invoices, allPayments, customers, planResponse] = await Promise.all([
        getAllPages<ApiSubscriptionSummary>("/subscriptions", 200, options),
        getAllPages<ApiInvoiceSummary>("/invoices", 200, options),
        getAllPages<ApiPayment>("/payments", 200, options),
        getAllPages<ApiCustomer>("/customers/", 100, options),
        apiClient.get<ApiPlan[]>("/plans/", options),
      ]);
      if (!planResponse.data) throw new Error("The plans endpoint returned no data.");
      const activeSubscriptions = subscriptions.filter((s) => s.status === "active");
      const overdueInvoices = invoices.filter((i) => i.status === "overdue");
      const payments = allPayments.filter((p) => p.status === "completed" || p.status === "partially_refunded");
      setData(calculateDashboard(
        activeSubscriptions,
        subscriptions,
        invoices,
        overdueInvoices,
        payments,
        customers,
        planResponse.data
      ));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchDashboard());
  }, [fetchDashboard]);

  // Every calendar month of the selected period, oldest first; months without records are zero.
  const areaData = useMemo(() => buildMonthWindow(data?.months ?? [], period), [data, period]);
  const statusTotal = data?.subscriptionStatuses.reduce((total, item) => total + item.count, 0) ?? 0;
  const hasRevenueData = areaData.some((d) => d.Revenue > 0 || d["New MRR"] > 0);
  const hasChurnData = areaData.some((d) => d["Churned MRR"] > 0);
  const revenueNotice = loading && !data
    ? "Loading…"
    : !hasRevenueData
      ? `No completed payments or new subscriptions in the last ${period} months.`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Command Center</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Real-time subscription and revenue overview</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchDashboard(); }} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard title="Active Subscriptions" value={data?.activeCount ?? (loading ? "…" : 0)} icon={CreditCard} description={`Of ${data?.subscriptionCount ?? 0} subscriptions`} />
          <StatCard title="Collected" value={data ? formatMinorUnits(data.collected) : "—"} icon={TrendingUp} description="Net completed payments" />
          <StatCard title="Outstanding" value={data ? formatMinorUnits(data.outstanding) : "—"} icon={FileText} description="Sent, partial and overdue invoices" />
          <StatCard title="Overdue" value={data ? formatMinorUnits(data.overdue) : "—"} icon={AlertCircle} description={`${data?.overdueCount ?? 0} overdue invoices`} />
          <StatCard title="MRR" value={data ? formatMinorUnits(data.mrr) : "—"} icon={BarChart2} description="Normalized using plan intervals" />
          <StatCard title="ARR" value={data ? formatMinorUnits(data.arr) : "—"} icon={Users} description="MRR × 12" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Customers: {data?.customerCount ?? (loading ? "…" : "—")}</p>
      </section>

      <section aria-label="Revenue analytics" className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Revenue over time</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Total revenue, new MRR and churned MRR per month (₹)</p>
          </div>
          <div className="flex gap-1 self-start sm:self-auto">
            {PERIOD_OPTIONS.map((option) => (
              <button key={option.value} onClick={() => setPeriod(option.value)} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${period === option.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={areaData} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradNewMrr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.922 0 0)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.split(" ")[0]} />
              {/* Separate scales: Revenue (left, blue) and New MRR (right, green) differ in size. */}
              <YAxis yAxisId="revenue" tick={{ fontSize: 11, fill: "#3b82f6" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatInrCents(v)} width={72} label={{ value: "Revenue (₹)", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#3b82f6", textAnchor: "middle" } }} />
              <YAxis yAxisId="newMrr" orientation="right" tick={{ fontSize: 11, fill: "#22c55e" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatInrCents(v)} width={72} label={{ value: "New MRR (₹)", angle: 90, position: "insideRight", offset: 0, style: { fontSize: 11, fill: "#22c55e", textAnchor: "middle" } }} />
              <Tooltip content={<RevenueTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Area yAxisId="revenue" type="monotone" dataKey="Revenue" stroke="#3b82f6" strokeWidth={2} fill="url(#gradRevenue)" dot={false} activeDot={{ r: 4 }} />
              <Area yAxisId="newMrr" type="monotone" dataKey="New MRR" stroke="#22c55e" strokeWidth={2} fill="url(#gradNewMrr)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
          {revenueNotice && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">{revenueNotice}</p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="Churned MRR" className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Churned MRR</h2>
          <p className="mb-4 text-xs text-muted-foreground">Monthly revenue lost to cancellations</p>
          {loading && !data ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
          ) : hasChurnData ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={areaData.map((d) => ({ month: d.month.split(" ")[0], "Churned MRR": d["Churned MRR"] }))} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.922 0 0)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatInrCents(v)} width={60} />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="Churned MRR" fill="#ef4444" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No cancellations recorded.</p>
          )}
        </section>

        <section aria-label="Subscription status breakdown" className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Subscription breakdown</h2>
          <p className="mb-4 text-xs text-muted-foreground">Current status distribution across all subscriptions</p>
          {data?.subscriptionStatuses.length ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <div className="shrink-0">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={data.subscriptionStatuses} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {data.subscriptionStatuses.map((entry) => <Cell key={entry.status} fill={STATUS_COLOURS[entry.status]} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value ?? 0} subscriptions`, String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-1 flex-col gap-2 text-sm">
                {data.subscriptionStatuses.map((entry) => (
                  <div key={entry.status} className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOURS[entry.status] }} />
                    <span className="flex-1 capitalize text-muted-foreground">{entry.status}</span>
                    <span className="font-medium tabular-nums">{entry.count}</span>
                    <span className="w-8 text-right text-xs text-muted-foreground">{statusTotal ? Math.round(entry.count / statusTotal * 100) : 0}%</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                  <span>Total subscriptions</span><span className="font-semibold tabular-nums text-foreground">{statusTotal}</span>
                </div>
              </div>
            </div>
          ) : <p className="py-16 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No subscriptions are available."}</p>}
        </section>
      </div>

      <section aria-label="Recent payments" className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent activity</h2>
        {data?.recentPayments.length ? (
          <ul className="divide-y divide-border">
            {data.recentPayments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">{payment.customer}</p>
                  <p className="font-mono text-xs text-muted-foreground">{payment.reference}</p>
                </div>
                <span className="text-muted-foreground">{formatDate(payment.date)}</span>
                <span className="font-medium tabular-nums">{formatMinorUnits(decimalToMinorUnits(payment.amount), payment.currency)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="py-6 text-sm text-muted-foreground">{loading ? "Loading…" : "No recent payment activity is available."}</p>}
      </section>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
        Live data: Revenue is net completed payments by payment date, New MRR is the monthly value of
        subscriptions by start month, and Churned MRR is subscriptions closed in each month.
      </div>
    </div>
  );
}

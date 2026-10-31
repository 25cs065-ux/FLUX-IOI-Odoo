"use client";

import { useMemo, useState } from "react";
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
import { MOCK_SUBSCRIPTIONS } from "@/mocks/subscriptions";
import { MOCK_INVOICES } from "@/mocks/invoices";
import {
  MOCK_REVENUE_CHART,
  MOCK_SUBSCRIPTION_STATUS_BREAKDOWN,
} from "@/mocks/command-center";
import { formatInrCents, formatInrCentsFull } from "@/lib/format";

// ---------------------------------------------------------------------------
// Period filter — limits which chart months are shown.
// The revenue data has 12 months; we offer 3, 6 and 12 month views.
// ---------------------------------------------------------------------------

type Period = 3 | 6 | 12;

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
];

// ---------------------------------------------------------------------------
// Colour palette for the status breakdown
// ---------------------------------------------------------------------------

const STATUS_COLOURS: Record<string, string> = {
  Active: "#22c55e",
  Pending: "#eab308",
  Overdue: "#f97316",
  Cancelled: "#ef4444",
};

// ---------------------------------------------------------------------------
// KPI calculations
//
// All amounts stay as integers (cents) throughout; we only divide at the
// final formatting step via formatInrCents / formatInrCentsFull.
// ---------------------------------------------------------------------------

function computeKpis() {
  // Active subscriptions
  const activeSubs = MOCK_SUBSCRIPTIONS.filter((s) => s.status === "active");
  const activeCount = activeSubs.length;

  // MRR = monthly subs + annual subs normalised to monthly (integer cents)
  // Use Math.round to avoid fractional cents from integer division.
  const mrrCents =
    activeSubs
      .filter((s) => s.billingInterval === "monthly")
      .reduce((acc, s) => acc + s.amountCents, 0) +
    activeSubs
      .filter((s) => s.billingInterval === "annual")
      .reduce((acc, s) => acc + Math.round(s.amountCents / 12), 0) +
    activeSubs
      .filter((s) => s.billingInterval === "quarterly")
      .reduce((acc, s) => acc + Math.round(s.amountCents / 3), 0);

  // ARR = MRR × 12 (integer cents)
  const arrCents = mrrCents * 12;

  // Total revenue = sum of all paid invoice totals
  const totalRevenueCents = MOCK_INVOICES.filter(
    (i) => i.status === "paid"
  ).reduce((acc, i) => acc + i.paidCents, 0);

  // Outstanding = sum of unpaid balances (pending + draft)
  const outstandingCents = MOCK_INVOICES.filter(
    (i) => i.status === "pending" || i.status === "draft"
  ).reduce((acc, i) => acc + (i.totalCents - i.paidCents), 0);

  // Overdue = sum of overdue invoice totals
  const overdueCents = MOCK_INVOICES.filter(
    (i) => i.status === "overdue"
  ).reduce((acc, i) => acc + i.totalCents, 0);

  return { activeCount, mrrCents, arrCents, totalRevenueCents, outstandingCents, overdueCents };
}

// ---------------------------------------------------------------------------
// Custom tooltip for Recharts
// ---------------------------------------------------------------------------

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
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block size-2 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums">
            {formatInrCentsFull(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommandCenterPage() {
  const [period, setPeriod] = useState<Period>(12);

  const kpis = useMemo(() => computeKpis(), []);

  // Slice the 12-month array to the selected period (most-recent N months)
  const chartData = useMemo(
    () => MOCK_REVENUE_CHART.slice(-period),
    [period]
  );

  // Format chart data: keep cents as-is for Recharts (we format in tooltip)
  const areaData = useMemo(
    () =>
      chartData.map((d) => ({
        month: d.month,
        Revenue: d.revenueCents,
        "New MRR": d.newMrrCents,
        "Churned MRR": d.churnedMrrCents,
      })),
    [chartData]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Command Center
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Real-time subscription and revenue overview
          </p>
        </div>
        <span className="self-start rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          Demo data — mock only
        </span>
      </div>

      {/* ── KPI stat cards ───────────────────────────────────────────── */}
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            title="Active Subscriptions"
            value={kpis.activeCount}
            icon={CreditCard}
            description={`Of ${MOCK_SUBSCRIPTIONS.length} total`}
            trend={{ direction: "up", label: "+2 this month" }}
          />
          <StatCard
            title="Total Revenue"
            value={formatInrCents(kpis.totalRevenueCents)}
            icon={TrendingUp}
            description="Sum of all paid invoices"
            trend={{ direction: "up", label: "this period" }}
          />
          <StatCard
            title="Outstanding"
            value={formatInrCents(kpis.outstandingCents)}
            icon={FileText}
            description="Pending + draft invoices"
            trend={{ direction: "neutral", label: "awaiting payment" }}
          />
          <StatCard
            title="Overdue"
            value={formatInrCents(kpis.overdueCents)}
            icon={AlertCircle}
            description="Past due date"
            trend={
              kpis.overdueCents > 0
                ? { direction: "down", label: "requires action" }
                : { direction: "neutral", label: "none overdue" }
            }
          />
          <StatCard
            title="MRR"
            value={formatInrCents(kpis.mrrCents)}
            icon={BarChart2}
            description="Monthly recurring revenue"
            trend={{ direction: "up", label: "from active plans" }}
          />
          <StatCard
            title="ARR"
            value={formatInrCents(kpis.arrCents)}
            icon={Users}
            description="MRR × 12"
            trend={{ direction: "up", label: "annualised" }}
          />
        </div>
      </section>

      {/* ── Revenue chart ────────────────────────────────────────────── */}
      <section
        aria-label="Revenue analytics"
        className="rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Revenue over time
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Total revenue, new MRR and churned MRR per month (₹)
            </p>
          </div>
          {/* Period selector */}
          <div className="flex gap-1 self-start sm:self-auto">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border ${
                  period === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <AreaChart
            data={areaData}
            margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
          >
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
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="oklch(0.922 0 0)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: string) => v.split(" ")[0]} // Show "Nov", "Dec" etc.
            />
            <YAxis
              tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatInrCents(v)}
              width={62}
            />
            <Tooltip content={<RevenueTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="circle"
              iconSize={8}
            />
            <Area
              type="monotone"
              dataKey="Revenue"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#gradRevenue)"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              type="monotone"
              dataKey="New MRR"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#gradNewMrr)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* ── Churned MRR bar chart + subscription status breakdown ─────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Churned MRR bar chart */}
        <section
          aria-label="Churned MRR"
          className="rounded-xl border border-border bg-card p-4"
        >
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Churned MRR
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Monthly revenue lost to cancellations
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={chartData.map((d) => ({
                month: d.month.split(" ")[0],
                "Churned MRR": d.churnedMrrCents,
              }))}
              margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="oklch(0.922 0 0)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "oklch(0.556 0 0)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => formatInrCents(v)}
                width={60}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Bar
                dataKey="Churned MRR"
                fill="#ef4444"
                fillOpacity={0.75}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Subscription status breakdown */}
        <section
          aria-label="Subscription status breakdown"
          className="rounded-xl border border-border bg-card p-4"
        >
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Subscription breakdown
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Current status distribution across all subscriptions
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            {/* Donut chart */}
            <div className="shrink-0">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={MOCK_SUBSCRIPTION_STATUS_BREAKDOWN}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {MOCK_SUBSCRIPTION_STATUS_BREAKDOWN.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={STATUS_COLOURS[entry.status] ?? "#94a3b8"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      `${value ?? 0} subscriptions`,
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend rows */}
            <div className="flex flex-col gap-2 text-sm flex-1">
              {MOCK_SUBSCRIPTION_STATUS_BREAKDOWN.map((entry) => {
                const total = MOCK_SUBSCRIPTION_STATUS_BREAKDOWN.reduce(
                  (acc, e) => acc + e.count,
                  0
                );
                const pct = Math.round((entry.count / total) * 100);
                return (
                  <div key={entry.status} className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-full shrink-0"
                      style={{
                        background:
                          STATUS_COLOURS[entry.status] ?? "#94a3b8",
                      }}
                    />
                    <span className="flex-1 text-muted-foreground">
                      {entry.status}
                    </span>
                    <span className="tabular-nums font-medium">
                      {entry.count}
                    </span>
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
              <div className="mt-1 border-t border-border pt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Total subscriptions</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {MOCK_SUBSCRIPTION_STATUS_BREAKDOWN.reduce(
                    (acc, e) => acc + e.count,
                    0
                  )}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Refresh note ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
        All figures are calculated from mock data. Connect
        <code className="font-mono bg-muted px-1 rounded">NEXT_PUBLIC_API_URL</code>
        to the backend to see live data.
      </div>
    </div>
  );
}

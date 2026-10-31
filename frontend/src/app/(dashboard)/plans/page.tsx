"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart2, WifiOff } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Plan {
  id: string;
  name: string;
  interval: string;
  price: number;
  min_quantity: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  auto_close: boolean;
  pausable: boolean;
  renewable: boolean;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Mock fallback
// ---------------------------------------------------------------------------

const MOCK_PLANS: Plan[] = [
  { id: "1", name: "Starter", interval: "monthly", price: 999, min_quantity: 1, is_active: true, start_date: null, end_date: null, auto_close: false, pausable: true, renewable: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "2", name: "Growth", interval: "monthly", price: 2999, min_quantity: 1, is_active: true, start_date: null, end_date: null, auto_close: false, pausable: true, renewable: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "3", name: "Enterprise", interval: "yearly", price: 29999, min_quantity: 1, is_active: true, start_date: null, end_date: null, auto_close: false, pausable: false, renewable: true, created_at: "2026-02-01T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<Plan>[] = [
  { key: "name", header: "Plan Name", cell: (r) => <span className="font-medium text-foreground">{r.name}</span> },
  {
    key: "price",
    header: "Price",
    cell: (r) => (
      <span>
        ₹{r.price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}{" "}
        <span className="text-muted-foreground text-xs">/ {r.interval}</span>
      </span>
    ),
  },
  { key: "interval", header: "Interval", cell: (r) => <span className="capitalize">{r.interval}</span> },
  { key: "min_quantity", header: "Min Qty", cell: (r) => String(r.min_quantity) },
  {
    key: "is_active",
    header: "Status",
    cell: (r) => <StatusBadge status={r.is_active ? "active" : "closed"} label={r.is_active ? "Active" : "Inactive"} />,
  },
  { key: "created_at", header: "Created", cell: (r) => formatDate(r.created_at), hideOnMobile: true },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ limit: 100 });
      const { data } = await apiClient.get<Plan[]>(`/plans/${qs}`, token ? { token } : undefined);
      if (data && Array.isArray(data)) {
        setPlans(data);
        setUsingMock(false);
      }
    } catch {
      setPlans(MOCK_PLANS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const active = plans.filter((p) => p.is_active).length;
  const inactive = plans.filter((p) => !p.is_active).length;
  const monthly = plans.filter((p) => p.interval === "monthly").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Plans</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Subscription plans available to customers.
          </p>
        </div>
        {usingMock && (
          <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <WifiOff className="size-3" />
            Demo data
          </span>
        )}
      </div>

      {/* Stat cards */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard title="Active Plans" value={active} icon={BarChart2} />
          <StatCard title="Inactive Plans" value={inactive} />
          <StatCard title="Monthly Plans" value={monthly} />
        </div>
      )}

      {/* Error */}
      {apiError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable
          columns={COLUMNS}
          data={plans}
          rowKey="id"
          searchPlaceholder="Search plans…"
          searchKeys={["name", "interval"]}
          emptyMessage={loading ? "Loading…" : "No plans found."}
          pageSize={10}
        />
      </div>
    </div>
  );
}

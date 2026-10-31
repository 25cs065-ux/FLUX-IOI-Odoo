"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { BarChart2, RefreshCw, WifiOff, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Plan {
  id: string;
  name: string;
  interval: "daily" | "weekly" | "monthly" | "yearly";
  price: number;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INTERVAL_LABEL: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function formatPrice(price: number, interval: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(price) + " / " + (INTERVAL_LABEL[interval] ?? interval).toLowerCase();
}

function BoolIcon({ value }: { value: boolean }) {
  return value ? (
    <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
  ) : (
    <XCircle className="size-4 text-muted-foreground/40" />
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<Plan>[] {
  return [
    {
      key: "name",
      header: "Plan name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "interval",
      header: "Interval",
      cell: (row) => INTERVAL_LABEL[row.interval] ?? row.interval,
      hideOnMobile: true,
    },
    {
      key: "price",
      header: "Price",
      cell: (row) => (
        <span className="tabular-nums">{formatPrice(row.price, row.interval)}</span>
      ),
    },
    {
      key: "min_quantity",
      header: "Min qty",
      cell: (row) => row.min_quantity,
      hideOnMobile: true,
    },
    {
      key: "pausable",
      header: "Pausable",
      cell: (row) => <BoolIcon value={row.pausable} />,
      hideOnMobile: true,
    },
    {
      key: "renewable",
      header: "Renewable",
      cell: (row) => <BoolIcon value={row.renewable} />,
      hideOnMobile: true,
    },
    {
      key: "is_active",
      header: "Status",
      cell: (row) => (
        <StatusBadge status={row.is_active ? "active" : "closed"} label={row.is_active ? "Active" : "Inactive"} />
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({
        is_active: filterActive === null ? undefined : filterActive,
      });
      const { data } = await apiClient.get<Plan[]>(`/plans/${qs}`, token ? { token } : undefined);
      if (data) {
        setPlans(data);
        setUsingMock(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load plans";
      setError(msg);
      setPlans([]);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [filterActive]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const stats = useMemo(() => ({
    total: plans.length,
    active: plans.filter((p) => p.is_active).length,
    monthly: plans.filter((p) => p.interval === "monthly").length,
    yearly: plans.filter((p) => p.interval === "yearly").length,
  }), [plans]);

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Plans</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Subscription billing plans</p>
        </div>
        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" /> Offline
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchPlans} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard title="Total plans" value={stats.total} icon={BarChart2} />
        <StatCard title="Active" value={stats.active} trend={{ direction: "up", label: "of total" }} />
        <StatCard title="Monthly" value={stats.monthly} description="Monthly billing plans" />
        <StatCard title="Yearly" value={stats.yearly} description="Annual billing plans" />
      </div>

      {/* Filter + Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex gap-1">
          {[{ label: "All", value: null }, { label: "Active", value: true }, { label: "Inactive", value: false }].map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => setFilterActive(opt.value)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border",
                filterActive === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <DataTable<Plan>
          columns={columns}
          data={plans}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search plans…"
          searchKeys={["name", "interval"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load." : "No plans found."}
        />
      </div>
    </div>
  );
}

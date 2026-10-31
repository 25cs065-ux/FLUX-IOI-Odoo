"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Tag, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient, buildQuery, clearApiCache } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Discount {
  id: string;
  code: string;
  discount_type: "fixed" | "percentage";
  value: number;
  min_purchase: number;
  min_quantity: number;
  start_date: string | null;
  end_date: string | null;
  usage_limit: number | null;
  usage_count: number;
  applies_to: "product" | "subscription";
  target_id: string | null;
  is_active: boolean;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<Discount>[] {
  return [
    {
      key: "code",
      header: "Code",
      cell: (row) => (
        <span className="font-mono text-xs font-semibold tracking-wide">{row.code}</span>
      ),
    },
    {
      key: "discount_type",
      header: "Type",
      cell: (row) => (
        <span className="capitalize">{row.discount_type}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: "value",
      header: "Value",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {row.discount_type === "percentage"
            ? `${row.value}%`
            : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(row.value)}
        </span>
      ),
    },
    {
      key: "applies_to",
      header: "Applies to",
      cell: (row) => <span className="capitalize">{row.applies_to}</span>,
      hideOnMobile: true,
    },
    {
      key: "usage_count",
      header: "Uses",
      cell: (row) => (
        <span className="tabular-nums">
          {row.usage_count}
          {row.usage_limit !== null ? ` / ${row.usage_limit}` : ""}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "end_date",
      header: "Expires",
      cell: (row) => formatDate(row.end_date),
      hideOnMobile: true,
    },
    {
      key: "is_active",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.is_active ? "active" : "closed"}
          label={row.is_active ? "Active" : "Inactive"}
        />
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  const fetchDiscounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ is_active: filterActive === null ? undefined : filterActive });
      const { data } = await apiClient.get<Discount[]>(`/discounts/${qs}`, token ? { token } : undefined);
      if (data) {
        setDiscounts(data);
        setUsingMock(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load discounts";
      setError(msg);
      setDiscounts([]);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [filterActive]);

  useEffect(() => {
    // Start the fetch after the effect returns, so its setState calls don't run synchronously inside the effect.
    void Promise.resolve().then(() => fetchDiscounts());
  }, [fetchDiscounts]);

  const stats = useMemo(() => ({
    total: discounts.length,
    active: discounts.filter((d) => d.is_active).length,
    percentageCount: discounts.filter((d) => d.discount_type === "percentage").length,
    fixedCount: discounts.filter((d) => d.discount_type === "fixed").length,
  }), [discounts]);

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Discounts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Discount codes and promotional offers</p>
        </div>
        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" /> Offline
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchDiscounts(); }} disabled={loading}>
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
        <StatCard title="Total codes" value={stats.total} icon={Tag} />
        <StatCard title="Active" value={stats.active} trend={{ direction: "up", label: "of total" }} />
        <StatCard title="Percentage" value={stats.percentageCount} description="% discount codes" />
        <StatCard title="Fixed amount" value={stats.fixedCount} description="Fixed ₹ discount codes" />
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
        <DataTable<Discount>
          columns={columns}
          data={discounts}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search by code…"
          searchKeys={["code", "discount_type", "applies_to"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load." : "No discounts found."}
        />
      </div>
    </div>
  );
}

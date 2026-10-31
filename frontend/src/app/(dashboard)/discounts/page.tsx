"use client";

import { useState, useEffect, useCallback } from "react";
import { Tag, WifiOff } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { apiClient, buildQuery } from "@/lib/api-client";
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
  applies_to: "product" | "subscription";
  usage_count: number;
  usage_limit: number | null;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Mock fallback
// ---------------------------------------------------------------------------

const MOCK_DISCOUNTS: Discount[] = [
  { id: "1", code: "LAUNCH20", discount_type: "percentage", value: 20, applies_to: "subscription", usage_count: 34, usage_limit: 100, is_active: true, start_date: "2026-01-01T00:00:00Z", end_date: "2026-12-31T23:59:59Z", created_at: "2026-01-01T00:00:00Z" },
  { id: "2", code: "FLAT500", discount_type: "fixed", value: 500, applies_to: "product", usage_count: 12, usage_limit: null, is_active: true, start_date: null, end_date: null, created_at: "2026-02-01T00:00:00Z" },
  { id: "3", code: "EXPIRED10", discount_type: "percentage", value: 10, applies_to: "subscription", usage_count: 50, usage_limit: 50, is_active: false, start_date: null, end_date: "2025-12-31T23:59:59Z", created_at: "2025-06-01T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<Discount>[] = [
  {
    key: "code",
    header: "Code",
    cell: (r) => (
      <span className="font-mono font-medium text-foreground tracking-wide">{r.code}</span>
    ),
  },
  {
    key: "discount_type",
    header: "Type",
    cell: (r) => (
      <span className="capitalize">{r.discount_type}</span>
    ),
  },
  {
    key: "value",
    header: "Value",
    cell: (r) =>
      r.discount_type === "percentage"
        ? `${r.value}%`
        : `₹${r.value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
  },
  {
    key: "applies_to",
    header: "Applies To",
    cell: (r) => <span className="capitalize">{r.applies_to}</span>,
  },
  {
    key: "usage_count",
    header: "Usage",
    cell: (r) =>
      r.usage_limit != null
        ? `${r.usage_count} / ${r.usage_limit}`
        : String(r.usage_count),
    hideOnMobile: true,
  },
  {
    key: "end_date",
    header: "Expires",
    cell: (r) => formatDate(r.end_date),
    hideOnMobile: true,
  },
  {
    key: "is_active",
    header: "Status",
    cell: (r) => (
      <StatusBadge
        status={r.is_active ? "active" : "closed"}
        label={r.is_active ? "Active" : "Inactive"}
      />
    ),
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const fetchDiscounts = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ limit: 100 });
      const { data } = await apiClient.get<Discount[]>(`/discounts${qs}`, token ? { token } : undefined);
      if (data && Array.isArray(data)) {
        setDiscounts(data);
        setUsingMock(false);
      }
    } catch {
      setDiscounts(MOCK_DISCOUNTS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDiscounts(); }, [fetchDiscounts]);

  const active = discounts.filter((d) => d.is_active).length;
  const inactive = discounts.filter((d) => !d.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Discounts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Discount codes and promotional offers.
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
          <StatCard title="Total Discounts" value={discounts.length} icon={Tag} />
          <StatCard title="Active" value={active} />
          <StatCard title="Inactive" value={inactive} />
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
          data={discounts}
          rowKey="id"
          searchPlaceholder="Search discounts…"
          searchKeys={["code"]}
          emptyMessage={loading ? "Loading…" : "No discounts found."}
          pageSize={10}
        />
      </div>
    </div>
  );
}

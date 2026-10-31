"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Package, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Variant {
  id: string;
  product_id: string;
  name: string;
  sku_suffix: string | null;
  extra_price: number;
  is_active: boolean;
  base_product_price: number;
  final_price: number;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<Variant>[] {
  return [
    {
      key: "name",
      header: "Variant name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "product_id",
      header: "Product ID",
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.product_id.slice(0, 8)}…</span>
      ),
      hideOnMobile: true,
    },
    {
      key: "sku_suffix",
      header: "SKU suffix",
      cell: (row) => row.sku_suffix ?? <span className="text-muted-foreground/50">—</span>,
      hideOnMobile: true,
    },
    {
      key: "base_product_price",
      header: "Base price",
      cell: (row) => (
        <span className="tabular-nums">
          {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(row.base_product_price)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "extra_price",
      header: "Extra",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          +{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(row.extra_price)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "final_price",
      header: "Final price",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(row.final_price)}
        </span>
      ),
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

export default function ProductsPage() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const { data } = await apiClient.get<Variant[]>("/variants/", token ? { token } : undefined);
      if (data) {
        setVariants(data);
        setUsingMock(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load products";
      setError(msg);
      setVariants([]);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVariants(); }, [fetchVariants]);

  const stats = useMemo(() => ({
    total: variants.length,
    active: variants.filter((v) => v.is_active).length,
    uniqueProducts: new Set(variants.map((v) => v.product_id)).size,
  }), [variants]);

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Products</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Product variants — each variant is a billable SKU on a subscription line
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" /> Offline
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchVariants} disabled={loading}>
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
      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Total variants" value={stats.total} icon={Package} />
        <StatCard title="Active" value={stats.active} trend={{ direction: "up", label: "of total" }} />
        <StatCard title="Unique products" value={stats.uniqueProducts} description="Distinct product IDs" />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<Variant>
          columns={columns}
          data={variants}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search variants…"
          searchKeys={["name", "product_id", "sku_suffix"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load." : "No product variants found."}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Percent, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Tax {
  id: string;
  name: string;
  rate: number;
  rule: string | null;
  is_active: boolean;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<Tax>[] {
  return [
    {
      key: "name",
      header: "Tax name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "rate",
      header: "Rate",
      cell: (row) => (
        <span className="tabular-nums font-medium">{row.rate}%</span>
      ),
    },
    {
      key: "rule",
      header: "Rule",
      cell: (row) => row.rule ?? <span className="text-muted-foreground/50">—</span>,
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

export default function TaxesPage() {
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  const fetchTaxes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ is_active: filterActive === null ? undefined : filterActive });
      const { data } = await apiClient.get<Tax[]>(`/taxes/${qs}`, token ? { token } : undefined);
      if (data) {
        setTaxes(data);
        setUsingMock(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load taxes";
      setError(msg);
      setTaxes([]);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [filterActive]);

  useEffect(() => { fetchTaxes(); }, [fetchTaxes]);

  const stats = useMemo(() => ({
    total: taxes.length,
    active: taxes.filter((t) => t.is_active).length,
    avgRate: taxes.length
      ? (taxes.reduce((sum, t) => sum + t.rate, 0) / taxes.length).toFixed(1)
      : "—",
  }), [taxes]);

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Taxes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Tax rates applied to subscription lines</p>
        </div>
        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" /> Offline
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchTaxes} disabled={loading}>
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
        <StatCard title="Total taxes" value={stats.total} icon={Percent} />
        <StatCard title="Active" value={stats.active} trend={{ direction: "up", label: "of total" }} />
        <StatCard title="Avg rate" value={`${stats.avgRate}%`} description="Average tax rate" />
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
        <DataTable<Tax>
          columns={columns}
          data={taxes}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search taxes…"
          searchKeys={["name", "rule"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load." : "No taxes found."}
        />
      </div>
    </div>
  );
}

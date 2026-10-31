"use client";

import { useState, useEffect, useCallback } from "react";
import { Percent, WifiOff } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

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
// Mock fallback
// ---------------------------------------------------------------------------

const MOCK_TAXES: Tax[] = [
  { id: "1", name: "GST 18%", rate: 18, rule: "Applied to all digital services", is_active: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "2", name: "GST 5%", rate: 5, rule: "Applied to essential goods", is_active: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "3", name: "TDS 10%", rate: 10, rule: "Applicable to freelance payments", is_active: false, created_at: "2026-02-01T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<Tax>[] = [
  {
    key: "name",
    header: "Tax Name",
    cell: (r) => <span className="font-medium text-foreground">{r.name}</span>,
  },
  {
    key: "rate",
    header: "Rate",
    cell: (r) => `${r.rate}%`,
  },
  {
    key: "rule",
    header: "Rule / Applicability",
    cell: (r) => r.rule ?? "—",
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
  {
    key: "created_at",
    header: "Created",
    cell: (r) => formatDate(r.created_at),
    hideOnMobile: true,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TaxesPage() {
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const fetchTaxes = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ limit: 100 });
      const { data } = await apiClient.get<Tax[]>(`/taxes${qs}`, token ? { token } : undefined);
      if (data && Array.isArray(data)) {
        setTaxes(data);
        setUsingMock(false);
      }
    } catch {
      setTaxes(MOCK_TAXES);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTaxes(); }, [fetchTaxes]);

  const active = taxes.filter((t) => t.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Taxes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tax rates and applicability rules.
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
          <StatCard title="Total Taxes" value={taxes.length} icon={Percent} />
          <StatCard title="Active" value={active} />
          <StatCard title="Inactive" value={taxes.length - active} />
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
          data={taxes}
          rowKey="id"
          searchPlaceholder="Search taxes…"
          searchKeys={["name", "rule"]}
          emptyMessage={loading ? "Loading…" : "No taxes found."}
          pageSize={10}
        />
      </div>
    </div>
  );
}

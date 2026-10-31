"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { FileStack, RefreshCw, WifiOff, Calendar } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient, buildQuery, clearApiCache } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateLine {
  id: string;
  template_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
}

interface QuotationTemplate {
  id: string;
  name: string;
  validity_days: number;
  terms_and_conditions: string | null;
  is_active: boolean;
  lines: TemplateLine[];
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<QuotationTemplate>[] {
  return [
    {
      key: "name",
      header: "Template name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "validity_days",
      header: "Valid for",
      cell: (row) => (
        <span className="flex items-center gap-1">
          <Calendar className="size-3 text-muted-foreground" aria-hidden="true" />
          {row.validity_days} day{row.validity_days !== 1 ? "s" : ""}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "lines",
      header: "Lines",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.lines.length}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: "terms_and_conditions",
      header: "T&C",
      cell: (row) =>
        row.terms_and_conditions ? (
          <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
            {row.terms_and_conditions.slice(0, 60)}{row.terms_and_conditions.length > 60 ? "…" : ""}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
      hideOnMobile: true,
    },
    {
      key: "created_at",
      header: "Created",
      cell: (row) => formatDate(row.created_at),
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

export default function QuotationTemplatesPage() {
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ is_active: filterActive === null ? undefined : filterActive });
      const { data } = await apiClient.get<QuotationTemplate[]>(
        `/quotation-templates/${qs}`,
        token ? { token } : undefined
      );
      if (data) {
        setTemplates(data);
        setUsingMock(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load templates";
      setError(msg);
      setTemplates([]);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [filterActive]);

  useEffect(() => {
    // Start the fetch after the effect returns, so its setState calls don't run synchronously inside the effect.
    void Promise.resolve().then(() => fetchTemplates());
  }, [fetchTemplates]);

  const stats = useMemo(() => ({
    total: templates.length,
    active: templates.filter((t) => t.is_active).length,
    avgValidity: templates.length
      ? Math.round(templates.reduce((s, t) => s + t.validity_days, 0) / templates.length)
      : 0,
  }), [templates]);

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Quotation Templates</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Reusable templates for subscription quotations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" /> Offline
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchTemplates(); }} disabled={loading}>
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
        <StatCard title="Total templates" value={stats.total} icon={FileStack} />
        <StatCard title="Active" value={stats.active} trend={{ direction: "up", label: "of total" }} />
        <StatCard title="Avg validity" value={`${stats.avgValidity}d`} description="Average validity in days" />
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
        <DataTable<QuotationTemplate>
          columns={columns}
          data={templates}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search templates…"
          searchKeys={["name"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load." : "No quotation templates found."}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { FileStack, WifiOff } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateLine {
  id: string;
  template_id: string;
  product_id: string;
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
// Mock fallback
// ---------------------------------------------------------------------------

const MOCK_TEMPLATES: QuotationTemplate[] = [
  {
    id: "1",
    name: "Standard SaaS Starter",
    validity_days: 30,
    terms_and_conditions: "Payment due within 30 days.",
    is_active: true,
    lines: [
      { id: "l1", template_id: "1", product_id: "p1", quantity: 1, unit_price: 999, discount_percentage: 0 },
    ],
    created_at: "2026-01-15T00:00:00Z",
  },
  {
    id: "2",
    name: "Enterprise Annual Proposal",
    validity_days: 14,
    terms_and_conditions: "Custom SLA applies.",
    is_active: true,
    lines: [
      { id: "l2", template_id: "2", product_id: "p2", quantity: 5, unit_price: 4999, discount_percentage: 10 },
    ],
    created_at: "2026-02-10T00:00:00Z",
  },
  {
    id: "3",
    name: "Legacy Growth Template",
    validity_days: 7,
    terms_and_conditions: null,
    is_active: false,
    lines: [],
    created_at: "2025-11-01T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<QuotationTemplate>[] = [
  {
    key: "name",
    header: "Template Name",
    cell: (r) => <span className="font-medium text-foreground">{r.name}</span>,
  },
  {
    key: "validity_days",
    header: "Validity",
    cell: (r) => `${r.validity_days} days`,
  },
  {
    key: "lines",
    header: "Line Items",
    cell: (r) => String(r.lines.length),
  },
  {
    key: "terms_and_conditions",
    header: "Terms",
    cell: (r) =>
      r.terms_and_conditions
        ? r.terms_and_conditions.length > 50
          ? `${r.terms_and_conditions.slice(0, 50)}…`
          : r.terms_and_conditions
        : "—",
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

export default function QuotationTemplatesPage() {
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ limit: 100 });
      const { data } = await apiClient.get<QuotationTemplate[]>(
        `/quotation-templates${qs}`,
        token ? { token } : undefined
      );
      if (data && Array.isArray(data)) {
        setTemplates(data);
        setUsingMock(false);
      }
    } catch {
      setTemplates(MOCK_TEMPLATES);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const active = templates.filter((t) => t.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Quotation Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reusable quote templates with preset line items.
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
          <StatCard title="Total Templates" value={templates.length} icon={FileStack} />
          <StatCard title="Active" value={active} />
          <StatCard title="Inactive" value={templates.length - active} />
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
          data={templates}
          rowKey="id"
          searchPlaceholder="Search templates…"
          searchKeys={["name"]}
          emptyMessage={loading ? "Loading…" : "No quotation templates found."}
          pageSize={10}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import { Package, RefreshCw, Plus, Pencil, X } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient, clearApiCache } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { decimalToMinorUnits, formatMinorUnits } from "@/lib/money";
import type { ApiVariant } from "@/types/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Variant = ApiVariant;

interface VariantForm {
  product_id: string;
  name: string;
  sku_suffix: string;
  extra_price: string;
  is_active: boolean;
}

const EMPTY_FORM: VariantForm = {
  product_id: "",
  name: "",
  sku_suffix: "",
  extra_price: "0.00",
  is_active: true,
};

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(onEdit: (variant: Variant) => void): ColumnDef<Variant>[] {
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
          {formatMinorUnits(decimalToMinorUnits(row.base_product_price))}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "extra_price",
      header: "Extra",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          +{formatMinorUnits(decimalToMinorUnits(row.extra_price))}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "final_price",
      header: "Final price",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {formatMinorUnits(decimalToMinorUnits(row.final_price))}
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
    {
      key: "_actions",
      header: "",
      cell: (row) => (
        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>
          <Pencil className="size-3.5" />
        </Button>
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Variant | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<VariantForm>(EMPTY_FORM);

  const fetchVariants = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setError(null);
      const { data } = await apiClient.get<Variant[]>("/variants/", token ? { token } : undefined);
      if (!data) throw new Error("The variants endpoint returned no data.");
      setVariants(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load products";
      setError(msg);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchVariants());
  }, [fetchVariants]);

  const stats = useMemo(() => ({
    total: variants.length,
    active: variants.filter((v) => v.is_active).length,
    uniqueProducts: new Set(variants.map((v) => v.product_id)).size,
  }), [variants]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDialogOpen(true);
  }

  async function openEdit(variant: Variant) {
    setError(null);
    try {
      const token = await getSupabaseToken();
      const { data } = await apiClient.get<Variant>(`/variants/${variant.id}`, token ? { token } : undefined);
      if (!data) throw new Error("The variant endpoint returned no details.");
      setEditing(data);
      setForm({
        product_id: data.product_id,
        name: data.name,
        sku_suffix: data.sku_suffix ?? "",
        extra_price: String(data.extra_price),
        is_active: data.is_active,
      });
      setDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load variant details.");
    }
  }

  async function saveVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const body = editing
        ? {
            name: form.name,
            sku_suffix: form.sku_suffix || null,
            extra_price: form.extra_price,
            is_active: form.is_active,
          }
        : {
            product_id: form.product_id,
            name: form.name,
            sku_suffix: form.sku_suffix || null,
            extra_price: form.extra_price,
            is_active: form.is_active,
          };
      if (editing) {
        await apiClient.patch(`/variants/${editing.id}`, body);
      } else {
        await apiClient.post("/variants/", body);
      }
      setDialogOpen(false);
      await fetchVariants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save variant.");
    }
  }

  const columns = useMemo(() => buildColumns(openEdit), [variants]);

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
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" /> Add variant
          </Button>
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchVariants(); }} disabled={loading}>
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

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveVariant} className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="variant-dialog-title">
            <div className="flex items-center justify-between">
              <h2 id="variant-dialog-title" className="font-semibold">{editing ? "Edit variant" : "Add variant"}</h2>
              <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close" onClick={() => setDialogOpen(false)}><X className="size-4" /></button>
            </div>
            {!editing && (
              <label className="block space-y-1 text-sm">
                <span>Product ID</span>
                <input required value={form.product_id} onChange={(event) => setForm({ ...form, product_id: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" />
              </label>
            )}
            <label className="block space-y-1 text-sm">
              <span>Variant name</span>
              <input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>SKU suffix</span>
              <input maxLength={50} value={form.sku_suffix} onChange={(event) => setForm({ ...form, sku_suffix: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Extra price</span>
              <input required inputMode="decimal" pattern="\\d+(\\.\\d{1,2})?" value={form.extra_price} onChange={(event) => setForm({ ...form, extra_price: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
              Active
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">{editing ? "Save changes" : "Create variant"}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

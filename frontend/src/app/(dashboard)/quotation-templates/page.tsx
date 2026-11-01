"use client";

import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import { FileStack, RefreshCw, Calendar, Plus, Eye, X, Trash2 } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { useSignedInUser } from "@/components/layout";
import { apiClient, buildQuery, clearApiCache } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types — match GET /quotation-templates/ (live table: name, plan, validity,
// active flag; lines: product, optional variant, quantity)
// ---------------------------------------------------------------------------

interface TemplateLine {
  id: string;
  template_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  product_name: string | null;
  variant_name: string | null;
}

interface QuotationTemplate {
  id: string;
  name: string;
  validity_days: number;
  plan_id: string | null;
  plan_name: string | null;
  is_active: boolean;
  lines: TemplateLine[];
  created_at: string | null;
}

interface PlanOption { id: string; name: string; is_active: boolean }
interface ProductOption { id: string; name: string; price: number }
interface VariantOption { id: string; product_id: string; name: string; final_price: number }

interface LineForm { key: number; product_id: string; variant_id: string; quantity: string }

interface TemplateForm {
  name: string;
  validity_days: string;
  plan_id: string;
  is_active: boolean;
  lines: LineForm[];
}

let lineKey = 0;
const newLine = (): LineForm => ({ key: ++lineKey, product_id: "", variant_id: "", quantity: "1" });
const emptyForm = (): TemplateForm => ({ name: "", validity_days: "30", plan_id: "", is_active: true, lines: [] });

const inputCls = "h-8 w-full rounded-md border border-input bg-background px-3 text-sm";

/** Client-side checks that mirror the API's rules; returns an error message or null. */
function validateForm(form: TemplateForm): string | null {
  if (form.name.trim().length < 2) return "Template name must be at least 2 characters.";
  if (form.name.trim().length > 150) return "Template name must be at most 150 characters.";
  const days = Number(form.validity_days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return "Validity must be a whole number of days between 1 and 3650.";
  for (const [index, line] of form.lines.entries()) {
    if (!line.product_id) return `Line ${index + 1}: choose a product.`;
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return `Line ${index + 1}: quantity must be a whole number of at least 1.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(onView: (template: QuotationTemplate) => void): ColumnDef<QuotationTemplate>[] {
  return [
    {
      key: "name",
      header: "Template name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "plan_name",
      header: "Plan",
      cell: (row) => row.plan_name ?? <span className="text-muted-foreground/50">—</span>,
      hideOnMobile: true,
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
      cell: (row) => <span className="tabular-nums text-muted-foreground">{row.lines.length}</span>,
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
        <StatusBadge status={row.is_active ? "active" : "closed"} label={row.is_active ? "Active" : "Inactive"} />
      ),
    },
    {
      key: "id",
      header: "",
      cell: (row) => (
        <Button size="sm" variant="outline" onClick={() => onView(row)} aria-label={`View ${row.name}`}>
          <Eye className="size-3.5" /> View
        </Button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QuotationTemplatesPage() {
  const user = useSignedInUser();
  const isAdmin = user?.role === "admin";

  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<{ plans: PlanOption[]; products: ProductOption[]; variants: VariantOption[] } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Details dialog
  const [selected, setSelected] = useState<QuotationTemplate | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ is_active: filterActive === null ? undefined : filterActive });
      const { data } = await apiClient.get<QuotationTemplate[]>(`/quotation-templates/${qs}`, token ? { token } : undefined);
      if (!data) throw new Error("The quotation templates endpoint returned no data.");
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
      setTemplates([]);
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

  const columns = useMemo(() => buildColumns((template) => {
    setDetailError(null);
    setSelected(template);
  }), []);

  async function openCreate() {
    setForm(emptyForm());
    setFormError(null);
    setDialogOpen(true);
    if (options) return;
    setOptionsError(null);
    try {
      const [plans, products, variants] = await Promise.all([
        apiClient.get<PlanOption[]>("/plans/?is_active=true"),
        apiClient.get<ProductOption[]>("/products/?is_active=true"),
        apiClient.get<VariantOption[]>("/variants/?is_active=true"),
      ]);
      setOptions({ plans: plans.data ?? [], products: products.data ?? [], variants: variants.data ?? [] });
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "Could not load plans and products.");
    }
  }

  function updateLine(key: number, changes: Partial<LineForm>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    }));
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateForm(form);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const { data } = await apiClient.post<QuotationTemplate>("/quotation-templates/", {
        name: form.name.trim(),
        validity_days: Number(form.validity_days),
        plan_id: form.plan_id || null,
        is_active: form.is_active,
        lines: form.lines.map((line) => ({
          product_id: line.product_id,
          variant_id: line.variant_id || null,
          quantity: Number(line.quantity),
        })),
      });
      if (!data) throw new Error("The API did not return the new template.");
      // Show it straight away when it matches the current filter.
      if (filterActive === null || filterActive === data.is_active) {
        setTemplates((current) => [data, ...current.filter((t) => t.id !== data.id)]);
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to create the template.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(template: QuotationTemplate) {
    setToggling(true);
    setDetailError(null);
    try {
      const { data } = await apiClient.patch<QuotationTemplate>(`/quotation-templates/${template.id}`, {
        is_active: !template.is_active,
      });
      if (!data) throw new Error("The API did not return the updated template.");
      setSelected(data);
      setTemplates((current) =>
        current
          .map((t) => (t.id === data.id ? data : t))
          .filter((t) => filterActive === null || t.is_active === filterActive)
      );
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to update the template.");
    } finally {
      setToggling(false);
    }
  }

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
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchTemplates(); }} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => void openCreate()}>
              <Plus className="size-3.5" /> Create template
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
          searchKeys={["name", "plan_name"]}
          emptyMessage={
            loading
              ? "Loading…"
              : error
                ? "Failed to load."
                : isAdmin
                  ? "No quotation templates yet. Use Create template to add the first one."
                  : "No quotation templates found."
          }
        />
      </div>

      {/* Create dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={createTemplate} noValidate className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="template-dialog-title">
            <div className="flex items-center justify-between">
              <h2 id="template-dialog-title" className="font-semibold">Create quotation template</h2>
              <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close" onClick={() => setDialogOpen(false)}><X className="size-4" /></button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm sm:col-span-2"><span>Template name</span>
                <input required minLength={2} maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputCls} placeholder="e.g. Enterprise annual proposal" />
              </label>
              <label className="space-y-1 text-sm"><span>Validity (days)</span>
                <input required type="number" min="1" max="3650" step="1" value={form.validity_days} onChange={(event) => setForm({ ...form, validity_days: event.target.value })} className={inputCls} />
              </label>
              <label className="space-y-1 text-sm"><span>Plan (optional)</span>
                <select value={form.plan_id} onChange={(event) => setForm({ ...form, plan_id: event.target.value })} className={inputCls} disabled={!options}>
                  <option value="">No plan</option>
                  {options?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
                Active (available when creating quotations)
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Quotation lines</span>
                <Button type="button" size="sm" variant="outline" disabled={!options || form.lines.length >= 50} onClick={() => setForm({ ...form, lines: [...form.lines, newLine()] })}>
                  <Plus className="size-3.5" /> Add line
                </Button>
              </div>
              {optionsError && <p className="text-sm text-destructive">{optionsError}</p>}
              {!options && !optionsError && <p className="text-xs text-muted-foreground">Loading plans and products…</p>}
              {options && form.lines.length === 0 && (
                <p className="text-xs text-muted-foreground">No lines yet. Lines are optional; prices come from the product and variant when a quotation is created.</p>
              )}
              {form.lines.map((line, index) => {
                const variants = options?.variants.filter((variant) => variant.product_id === line.product_id) ?? [];
                return (
                  <div key={line.key} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end">
                    <label className="space-y-1 text-xs"><span>Product (line {index + 1})</span>
                      <select required value={line.product_id} onChange={(event) => updateLine(line.key, { product_id: event.target.value, variant_id: "" })} className={inputCls}>
                        <option value="">Choose a product…</option>
                        {options?.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs"><span>Variant (optional)</span>
                      <select value={line.variant_id} onChange={(event) => updateLine(line.key, { variant_id: event.target.value })} className={inputCls} disabled={!line.product_id || variants.length === 0}>
                        <option value="">{line.product_id && variants.length === 0 ? "No variants" : "Base product"}</option>
                        {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs"><span>Quantity</span>
                      <input required type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} className={inputCls} />
                    </label>
                    <button type="button" className="h-8 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Remove line ${index + 1}`} onClick={() => setForm({ ...form, lines: form.lines.filter((l) => l.key !== line.key) })}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Terms and conditions and per-line prices are not stored on templates: the template table has no such columns.
            </p>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || !options}>{saving ? "Creating…" : "Create template"}</Button>
            </div>
          </form>
        </div>
      )}

      {/* Details dialog */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="template-detail-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="template-detail-title" className="font-semibold">{selected.name}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Created {formatDate(selected.created_at)}</p>
              </div>
              <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close" onClick={() => setSelected(null)}><X className="size-4" /></button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1"><StatusBadge status={selected.is_active ? "active" : "closed"} label={selected.is_active ? "Active" : "Inactive"} /></dd></div>
              <div><dt className="text-xs text-muted-foreground">Valid for</dt><dd className="mt-1 font-medium">{selected.validity_days} day{selected.validity_days !== 1 ? "s" : ""}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Plan</dt><dd className="mt-1 font-medium">{selected.plan_name ?? "No plan"}</dd></div>
            </dl>
            <div>
              <p className="mb-2 text-sm font-medium">Lines</p>
              {selected.lines.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Product</th><th className="py-1.5 font-medium">Variant</th><th className="py-1.5 text-right font-medium">Qty</th></tr></thead>
                  <tbody>
                    {selected.lines.map((line) => (
                      <tr key={line.id} className="border-b border-border last:border-0">
                        <td className="py-1.5">{line.product_name ?? line.product_id}</td>
                        <td className="py-1.5 text-muted-foreground">{line.variant_name ?? "Base product"}</td>
                        <td className="py-1.5 text-right tabular-nums">{line.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm text-muted-foreground">This template has no preset lines.</p>}
            </div>
            {detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
            <div className="flex justify-end gap-2">
              {isAdmin && (
                <Button variant="outline" onClick={() => void toggleActive(selected)} disabled={toggling}>
                  {toggling ? "Saving…" : selected.is_active ? "Deactivate" : "Activate"}
                </Button>
              )}
              <Button onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

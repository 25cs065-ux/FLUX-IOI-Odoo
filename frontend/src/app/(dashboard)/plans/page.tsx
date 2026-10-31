"use client";

import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import { BarChart2, RefreshCw, Plus, Pencil, X, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate, formatLabel } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits } from "@/lib/money";
import type { ApiPlan } from "@/types/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Plan = ApiPlan;

interface PlanForm {
  name: string;
  interval: Plan["interval"];
  price: string;
  min_quantity: string;
  start_date: string;
  end_date: string;
  auto_close: boolean;
  closable_early: boolean;
  pausable: boolean;
  renewable: boolean;
  is_active: boolean;
}

const EMPTY_FORM: PlanForm = {
  name: "",
  interval: "monthly",
  price: "0.00",
  min_quantity: "1",
  start_date: "",
  end_date: "",
  auto_close: false,
  closable_early: true,
  pausable: true,
  renewable: true,
  is_active: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INTERVAL_LABEL: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function formatPrice(price: string | number, interval: string): string {
  return formatMinorUnits(decimalToMinorUnits(price), "INR") + " / " + (INTERVAL_LABEL[interval] ?? interval).toLowerCase();
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

function buildColumns(onEdit: (plan: Plan) => void): ColumnDef<Plan>[] {
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

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  const fetchPlans = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setError(null);
      const qs = buildQuery({
        is_active: filterActive === null ? undefined : filterActive,
      });
      const { data } = await apiClient.get<Plan[]>(`/plans/${qs}`, token ? { token } : undefined);
      if (!data) throw new Error("The plans endpoint returned no data.");
      setPlans(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load plans";
      setError(msg);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [filterActive]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchPlans());
  }, [fetchPlans]);

  const stats = useMemo(() => ({
    total: plans.length,
    active: plans.filter((p) => p.is_active).length,
    monthly: plans.filter((p) => p.interval === "monthly").length,
    yearly: plans.filter((p) => p.interval === "yearly").length,
  }), [plans]);

  function formFromPlan(plan: Plan): PlanForm {
    return {
      name: plan.name,
      interval: plan.interval,
      price: String(plan.price),
      min_quantity: String(plan.min_quantity),
      start_date: plan.start_date ?? "",
      end_date: plan.end_date ?? "",
      auto_close: plan.auto_close,
      closable_early: plan.closable_early,
      pausable: plan.pausable,
      renewable: plan.renewable,
      is_active: plan.is_active,
    };
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDialogOpen(true);
  }

  async function openEdit(plan: Plan) {
    setError(null);
    try {
      const token = await getSupabaseToken();
      const { data } = await apiClient.get<Plan>(`/plans/${plan.id}`, token ? { token } : undefined);
      if (!data) throw new Error("The plan endpoint returned no details.");
      setEditing(data);
      setForm(formFromPlan(data));
      setDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load plan details.");
    }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const body = {
      name: form.name,
      interval: form.interval,
      price: form.price,
      min_quantity: Number(form.min_quantity),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      auto_close: form.auto_close,
      closable_early: form.closable_early,
      pausable: form.pausable,
      renewable: form.renewable,
      is_active: form.is_active,
    };
    try {
      if (editing) await apiClient.patch(`/plans/${editing.id}`, body);
      else await apiClient.post("/plans/", body);
      setDialogOpen(false);
      await fetchPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save plan.");
    }
  }

  const columns = useMemo(() => buildColumns(openEdit), [plans]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Plans</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Subscription billing plans</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" /> Add plan
          </Button>
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

        {dialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={savePlan} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title">
              <div className="flex items-center justify-between">
                <h2 id="plan-dialog-title" className="font-semibold">{editing ? "Edit plan" : "Add plan"}</h2>
                <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close" onClick={() => setDialogOpen(false)}><X className="size-4" /></button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm"><span>Name</span><input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                <label className="space-y-1 text-sm"><span>Billing interval</span><select value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value as Plan["interval"] })} className="h-8 w-full rounded-md border border-input bg-background px-3">{Object.entries(INTERVAL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="space-y-1 text-sm"><span>Price</span><input required inputMode="decimal" pattern="\\d+(\\.\\d{1,2})?" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                <label className="space-y-1 text-sm"><span>Minimum quantity</span><input required type="number" min="1" step="1" value={form.min_quantity} onChange={(event) => setForm({ ...form, min_quantity: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                <label className="space-y-1 text-sm"><span>Start date</span><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                <label className="space-y-1 text-sm"><span>End date</span><input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["auto_close", "closable_early", "pausable", "renewable", "is_active"] as const).map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.checked })} />{formatLabel(field)}</label>
                ))}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit">{editing ? "Save changes" : "Create plan"}</Button></div>
            </form>
          </div>
        )}
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

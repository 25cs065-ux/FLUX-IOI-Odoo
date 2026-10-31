"use client";

import { useState, useMemo, useEffect, useCallback, type FormEvent } from "react";
import {
  CreditCard,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  Eye,
  PauseCircle,
  PlayCircle,
  X,
  RefreshCw,
  Plus,
  Send,
  RotateCw,
} from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";

import {
  DataTable,
  StatusBadge,
  StatCard,
  ConfirmDialog,
  type ColumnDef,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { formatDate, formatLabel } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits, multiplyMinorUnits } from "@/lib/money";
import { apiClient, clearApiCache, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type {
  ApiCustomer,
  ApiPlan,
  ApiSubscription,
  ApiSubscriptionSummary,
  StatusHistory,
  SubscriptionStatus,
} from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter — map backend response to the shape the UI expects
// ---------------------------------------------------------------------------

interface SubscriptionRow {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  amount: string;
  currency: string;
  billingInterval: ApiPlan["interval"] | "unknown";
  renewable: boolean;
  startDate: string;
  nextBillingDate: string | null;
  closedDate: string | null;
  autoRenew: boolean;
  notes: string | null;
  quantity: string;
  endDate: string | null;
}

interface SubscriptionForm {
  customer_id: string;
  plan_id: string;
  start_date: string;
  end_date: string;
  quantity: string;
  notes: string;
  auto_renew: boolean;
}

const EMPTY_SUBSCRIPTION_FORM: SubscriptionForm = {
  customer_id: "",
  plan_id: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  quantity: "1",
  notes: "",
  auto_renew: true,
};

function adaptSubscription(
  api: ApiSubscriptionSummary,
  customers: Map<string, ApiCustomer>,
  plans: Map<string, ApiPlan>
): SubscriptionRow {
  const plan = plans.get(api.plan_id);
  return {
    id: api.id,
    reference: api.subscription_number,
    customerId: api.customer_id,
    customerName: customers.get(api.customer_id)?.name ?? api.customer_id,
    planId: api.plan_id,
    planName: plan?.name ?? api.plan_id,
    status: api.status,
    amount: api.total_amount,
    currency: api.currency,
    billingInterval: plan?.interval ?? "unknown",
    renewable: plan?.renewable ?? false,
    startDate: api.start_date,
    nextBillingDate: api.next_billing_date,
    closedDate: api.closed_at ?? null,
    autoRenew: api.auto_renew,
    notes: api.notes,
    quantity: api.quantity,
    endDate: api.end_date,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SubStatus = SubscriptionStatus;

const STATUS_FILTER_OPTIONS: { label: string; value: SubStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Quotation", value: "quotation" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Active", value: "active" },
  { label: "Paused", value: "paused" },
  { label: "Closed", value: "closed" },
];

// Backend action names
type ActionKind =
  | "send-quotation"
  | "confirm"
  | "activate"
  | "pause"
  | "resume"
  | "close"
  | "renew";

interface PendingAction {
  kind: ActionKind;
  sub: SubscriptionRow;
}

const ACTION_CONFIG: Record<ActionKind, { title: string; description: (ref: string) => string; confirmLabel: string; destructive: boolean; endpoint: string }> = {
  "send-quotation": {
    title: "Send quotation",
    description: (ref) => `Send a quotation for ${ref}.`,
    confirmLabel: "Send quotation",
    destructive: false,
    endpoint: "send-quotation",
  },
  confirm: {
    title: "Confirm subscription",
    description: (ref) =>
      `Confirm ${ref} — moves it from quotation/draft to confirmed status.`,
    confirmLabel: "Confirm",
    destructive: false,
    endpoint: "confirm",
  },
  activate: {
    title: "Activate subscription",
    description: (ref) =>
      `Activate ${ref}. The customer will be billed on the next billing date.`,
    confirmLabel: "Activate",
    destructive: false,
    endpoint: "activate",
  },
  pause: {
    title: "Pause subscription",
    description: (ref) =>
      `Pause ${ref}. No invoices will be generated while the subscription is paused.`,
    confirmLabel: "Pause",
    destructive: false,
    endpoint: "pause",
  },
  resume: {
    title: "Resume subscription",
    description: (ref) =>
      `Resume ${ref}. Billing will restart on the next billing cycle.`,
    confirmLabel: "Resume",
    destructive: false,
    endpoint: "resume",
  },
  close: {
    title: "Close subscription",
    description: (ref) =>
      `Close ${ref}. This is permanent and cannot be undone.`,
    confirmLabel: "Close subscription",
    destructive: true,
    endpoint: "close",
  },
  renew: {
    title: "Renew subscription",
    description: (ref) => `Renew ${ref} for another billing term.`,
    confirmLabel: "Renew",
    destructive: false,
    endpoint: "renew",
  },
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(
  onView: (sub: SubscriptionRow) => void
): ColumnDef<SubscriptionRow>[] {
  return [
    {
      key: "reference",
      header: "Reference",
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.reference}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row) => (
        <span className="font-medium">{row.customerName}</span>
      ),
    },
    {
      key: "planName",
      header: "Plan",
      cell: (row) => row.planName,
      hideOnMobile: true,
    },
    {
      key: "amount",
      header: "Amount",
      cell: (row) => (
        <span className="tabular-nums">
          {formatMinorUnits(decimalToMinorUnits(row.amount), row.currency)}
          <span className="ml-1 text-xs text-muted-foreground">
            /{row.billingInterval.slice(0, 2)}
          </span>
        </span>
      ),
    },
    {
      key: "nextBillingDate",
      header: "Next billing",
      cell: (row) => formatDate(row.nextBillingDate),
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "_actions",
      header: "",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onView(row)}
          aria-label={`View ${row.reference}`}
        >
          <Eye className="size-3.5" />
        </Button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SubscriptionsPage() {
  // ── State ────────────────────────────────────────────────────────────────
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<SubStatus | "all">("all");
  const [selectedSub, setSelectedSub] = useState<SubscriptionRow | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<ApiSubscription | null>(null);
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<SubscriptionRow | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionForm>(EMPTY_SUBSCRIPTION_FORM);

  // ── Fetch from API ───────────────────────────────────────────────────────
  const fetchSubs = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setApiError(null);
      const options = token ? { token } : undefined;
      const [subscriptionData, customerData, planResponse] = await Promise.all([
        getAllPages<ApiSubscriptionSummary>("/subscriptions", 200, options),
        getAllPages<ApiCustomer>("/customers/", 100, options),
        apiClient.get<ApiPlan[]>("/plans/", options),
      ]);
      if (!planResponse.data) {
        throw new Error("The backend returned an incomplete subscription response.");
      }
      setCustomers(customerData);
      setPlans(planResponse.data);
      const customerMap = new Map(customerData.map((customer) => [customer.id, customer]));
      const planMap = new Map(planResponse.data.map((plan) => [plan.id, plan]));
      setSubs(subscriptionData.map((subscription) => adaptSubscription(subscription, customerMap, planMap)));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to load subscriptions.");
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchSubs());
  }, [fetchSubs]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const filteredSubs = useMemo(
    () => statusFilter === "all" ? subs : subs.filter((sub) => sub.status === statusFilter),
    [subs, statusFilter]
  );

  const stats = useMemo(() => {
    const active = subs.filter((s) => s.status === "active").length;
    const confirmed = subs.filter((s) => s.status === "confirmed").length;
    const paused = subs.filter((s) => s.status === "paused").length;
    const mrr = subs.filter((sub) => sub.status === "active").reduce((total, sub) => {
      const amount = decimalToMinorUnits(sub.amount);
      if (sub.billingInterval === "daily") return total + amount * 30n;
      if (sub.billingInterval === "weekly") return total + multiplyMinorUnits(amount, 433n, 100n);
      if (sub.billingInterval === "yearly") return total + multiplyMinorUnits(amount, 1n, 12n);
      if (sub.billingInterval === "monthly") return total + amount;
      return total;
    }, 0n);
    return { active, confirmed, paused, mrr };
  }, [subs]);

  const openSubscription = useCallback(async (sub: SubscriptionRow) => {
    setSelectedSub(sub);
    setSelectedDetails(null);
    setHistory([]);
    setApiError(null);
    try {
      const token = await getSupabaseToken();
      const options = token ? { token } : undefined;
      const [detailResponse, historyResponse] = await Promise.all([
        apiClient.get<ApiSubscription>(`/subscriptions/${sub.id}`, options),
        apiClient.get<StatusHistory[]>(`/subscriptions/${sub.id}/history`, options),
      ]);
      if (!detailResponse.data || !historyResponse.data) {
        throw new Error("The backend returned incomplete subscription details.");
      }
      setSelectedDetails(detailResponse.data);
      setHistory(historyResponse.data);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to load subscription details.");
    }
  }, []);

  function openCreateDialog() {
    setEditingSub(null);
    setSubscriptionForm({
      ...EMPTY_SUBSCRIPTION_FORM,
      customer_id: customers[0]?.id ?? "",
      plan_id: plans.find((plan) => plan.is_active)?.id ?? "",
    });
    setCreateOpen(true);
  }

  function openEditDialog(sub: SubscriptionRow) {
    setEditingSub(sub);
    setSubscriptionForm({
      customer_id: sub.customerId,
      plan_id: sub.planId,
      start_date: sub.startDate,
      end_date: sub.endDate ?? "",
      quantity: sub.quantity,
      notes: sub.notes ?? "",
      auto_renew: sub.autoRenew,
    });
    setCreateOpen(true);
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError(null);
    const body = editingSub
      ? editingSub.status === "draft" || editingSub.status === "quotation"
        ? {
            plan_id: subscriptionForm.plan_id,
            start_date: subscriptionForm.start_date,
            end_date: subscriptionForm.end_date || null,
            quantity: subscriptionForm.quantity,
            notes: subscriptionForm.notes || null,
            auto_renew: subscriptionForm.auto_renew,
          }
        : {
            notes: subscriptionForm.notes || null,
            auto_renew: subscriptionForm.auto_renew,
          }
      : {
          customer_id: subscriptionForm.customer_id,
          plan_id: subscriptionForm.plan_id,
          start_date: subscriptionForm.start_date,
          end_date: subscriptionForm.end_date || null,
          quantity: subscriptionForm.quantity,
          notes: subscriptionForm.notes || null,
          auto_renew: subscriptionForm.auto_renew,
          currency: "INR",
        };
    try {
      if (editingSub) await apiClient.patch(`/subscriptions/${editingSub.id}`, body);
      else await apiClient.post("/subscriptions", body);
      setCreateOpen(false);
      setEditingSub(null);
      await fetchSubs();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Unable to save subscription.");
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  async function applyAction(action: ActionKind, id: string) {
    setActionLoading(true);
    setActionError(null);

    try {
      const token = await getSupabaseToken();
      await apiClient.post(
        `/subscriptions/${id}/${ACTION_CONFIG[action].endpoint}`,
        {},
        token ? { token } : undefined
      );
      await fetchSubs();
      setPendingAction(null);
      setSelectedSub(null);
      setSelectedDetails(null);
      setActionLoading(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed.");
      setActionLoading(false);
    }
  }

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = useMemo(() => buildColumns(openSubscription), [openSubscription]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Subscriptions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage recurring billing relationships
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-3.5" /> New subscription
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { clearApiCache(); void fetchSubs(); }}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* API error banner */}
      {(apiError || actionError) && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {actionError ?? apiError}
          <button
            className="ml-auto text-xs underline"
            onClick={() => { setActionError(null); setApiError(null); }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Active"
          value={stats.active}
          icon={CheckCircle2}
          trend={{ direction: "up", label: "of total" }}
        />
        <StatCard
          title="MRR"
          value={formatMinorUnits(stats.mrr)}
          icon={CreditCard}
          description="Monthly recurring revenue"
        />
        <StatCard
          title="Confirmed"
          value={stats.confirmed}
          icon={Clock}
          trend={{ direction: "neutral", label: "awaiting activation" }}
        />
        <StatCard
          title="Paused"
          value={stats.paused}
          icon={AlertCircle}
          trend={stats.paused > 0 ? { direction: "down", label: "billing suspended" } : undefined}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<SubscriptionRow>
          columns={columns}
          data={filteredSubs}
          rowKey="id"
          pageSize={8}
          searchPlaceholder="Search by customer, plan, reference…"
          searchKeys={["customerName", "planName", "reference", "status"]}
          emptyMessage={loading ? "Loading…" : apiError ? "Failed to load subscriptions." : "No subscriptions match the current filter."}
          filterControls={
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border",
                    statusFilter === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />
      </div>

      {/* Detail Drawer */}
      <SubscriptionDrawer
        sub={selectedSub}
        detail={selectedDetails}
        history={history}
        onClose={() => { setSelectedSub(null); setSelectedDetails(null); }}
        onAction={(kind, sub) => setPendingAction({ kind, sub })}
        onEdit={openEditDialog}
      />

      {/* Confirm dialog */}
      {pendingAction && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) { setPendingAction(null); setActionError(null); } }}
          title={ACTION_CONFIG[pendingAction.kind].title}
          description={ACTION_CONFIG[pendingAction.kind].description(
            pendingAction.sub.reference
          )}
          confirmLabel={
            actionLoading ? "Working…" : ACTION_CONFIG[pendingAction.kind].confirmLabel
          }
          destructive={ACTION_CONFIG[pendingAction.kind].destructive}
          onConfirm={() => applyAction(pendingAction.kind, pendingAction.sub.id)}
        />
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveSubscription} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="subscription-form-title">
            <div className="flex items-center justify-between">
              <h2 id="subscription-form-title" className="font-semibold">{editingSub ? `Edit ${editingSub.reference}` : "New subscription"}</h2>
              <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close" onClick={() => setCreateOpen(false)}><X className="size-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {!editingSub && <label className="space-y-1 text-sm"><span>Customer</span><select required value={subscriptionForm.customer_id} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, customer_id: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3"><option value="">Select customer…</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.email})</option>)}</select></label>}
              <label className="space-y-1 text-sm"><span>Plan</span><select required value={subscriptionForm.plan_id} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, plan_id: event.target.value })} disabled={!!editingSub && editingSub.status !== "draft" && editingSub.status !== "quotation"} className="h-8 w-full rounded-md border border-input bg-background px-3"><option value="">Select plan…</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} ({plan.interval})</option>)}</select></label>
              <label className="space-y-1 text-sm"><span>Start date</span><input required type="date" value={subscriptionForm.start_date} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, start_date: event.target.value })} disabled={!!editingSub && editingSub.status !== "draft" && editingSub.status !== "quotation"} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
              <label className="space-y-1 text-sm"><span>End date (optional)</span><input type="date" value={subscriptionForm.end_date} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, end_date: event.target.value })} disabled={!!editingSub && editingSub.status !== "draft" && editingSub.status !== "quotation"} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
              <label className="space-y-1 text-sm"><span>Quantity</span><input required type="number" min="1" step="0.0001" value={subscriptionForm.quantity} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, quantity: event.target.value })} disabled={!!editingSub && editingSub.status !== "draft" && editingSub.status !== "quotation"} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={subscriptionForm.auto_renew} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, auto_renew: event.target.checked })} />Auto renew</label>
            </div>
            <label className="block space-y-1 text-sm"><span>Notes</span><textarea maxLength={2000} value={subscriptionForm.notes} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, notes: event.target.value })} className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
            {apiError && <p className="text-sm text-destructive">{apiError}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit">{editingSub ? "Save changes" : "Create draft"}</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription detail drawer (slide-in panel using Dialog)
// ---------------------------------------------------------------------------

interface DrawerProps {
  sub: SubscriptionRow | null;
  detail: ApiSubscription | null;
  history: StatusHistory[];
  onClose: () => void;
  onAction: (kind: ActionKind, sub: SubscriptionRow) => void;
  onEdit: (sub: SubscriptionRow) => void;
}

function SubscriptionDrawer({ sub, detail, history, onClose, onAction, onEdit }: DrawerProps) {
  if (!sub) return null;

  const availableActions: ActionKind[] = (() => {
    switch (sub.status) {
      case "draft": return ["send-quotation", "confirm", "close"];
      case "quotation": return ["confirm", "close"];
      case "confirmed": return ["activate", "close"];
      case "active": return ["pause", "close", ...(sub.renewable ? ["renew" as const] : [])];
      case "paused": return ["resume", "close"];
      default: return [];
    }
  })();

  const actionIcons: Partial<Record<ActionKind, React.ReactNode>> = {
    "send-quotation": <Send className="size-3.5" />,
    confirm: <CheckCircle2 className="size-3.5" />,
    activate: <PlayCircle className="size-3.5" />,
    pause: <PauseCircle className="size-3.5" />,
    resume: <PlayCircle className="size-3.5" />,
    close: <XCircle className="size-3.5" />,
    renew: <RotateCw className="size-3.5" />,
  };

  return (
    <Dialog.Root open modal onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200"
        />
        <Dialog.Popup
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-xl",
            "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
            "transition-transform duration-200"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold">
                {sub.reference}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {sub.customerName} · {sub.planName} plan
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <button
                  className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              }
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Status badge */}
            <div className="flex items-center gap-2">
              <StatusBadge status={sub.status} />
            </div>

            {/* Detail grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <DetailRow label="Customer" value={sub.customerName} />
              <DetailRow label="Plan" value={sub.planName} />
              <DetailRow
                label="Amount"
                value={`${formatMinorUnits(decimalToMinorUnits(detail?.total_amount ?? sub.amount), sub.currency)} / ${sub.billingInterval}`}
              />
              <DetailRow label="Interval" value={formatLabel(sub.billingInterval)} />
              <DetailRow label="Start date" value={formatDate(sub.startDate)} />
              <DetailRow label="End date" value={formatDate(detail?.end_date ?? sub.endDate)} />
              <DetailRow
                label="Next billing"
                value={formatDate(sub.nextBillingDate)}
              />
              {sub.closedDate && (
                <DetailRow
                  label="Closed on"
                  value={formatDate(sub.closedDate)}
                />
              )}
            </dl>

            {detail ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Line items</h3>
                <ul className="space-y-2 text-sm">
                  {detail.lines.map((line) => (
                    <li key={line.id} className="flex justify-between gap-3">
                      <span>{line.description} × {line.quantity}</span>
                      <span className="tabular-nums">{formatMinorUnits(decimalToMinorUnits(line.line_total), sub.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading subscription details…</p>
            )}

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Status history
              </h3>
              {history.length ? (
                <ol className="space-y-2">
                  {history.map((event) => (
                    <li key={event.id} className="flex items-start gap-3 text-sm">
                      <span className="mt-1 size-2.5 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="leading-tight">{event.from_status ? `${formatLabel(event.from_status)} → ` : ""}{formatLabel(event.to_status)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(event.changed_at)}{event.reason ? ` · ${event.reason}` : ""}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">{detail ? "No status history is available." : "Loading status history…"}</p>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div className="border-t border-border px-5 py-4 flex flex-wrap gap-2">
            {(sub.status === "draft" || sub.status === "quotation") && (
              <Button variant="outline" size="sm" onClick={() => onEdit(sub)}>Edit</Button>
            )}
              {availableActions.map((kind) => (
                <Button
                  key={kind}
                  variant={kind === "close" ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => onAction(kind, sub)}
                >
                  {actionIcons[kind]}
                  {ACTION_CONFIG[kind].confirmLabel}
                </Button>
              ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </>
  );
}

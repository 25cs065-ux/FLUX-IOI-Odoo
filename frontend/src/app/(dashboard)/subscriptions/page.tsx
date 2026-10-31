"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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
  WifiOff,
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
import {
  MOCK_SUBSCRIPTIONS,
  type MockSubscription,
} from "@/mocks/subscriptions";
import { formatCents, formatDate, formatLabel, formatDecimalInr } from "@/lib/format";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiSubscription } from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter — map backend response to the shape the UI expects
// ---------------------------------------------------------------------------

function adaptSubscription(api: ApiSubscription): MockSubscription {
  // Convert decimal string amount to cents for reuse with existing formatCents.
  const amountCents = Math.round(parseFloat(api.amount) * 100);
  return {
    id: api.id,
    reference: api.reference,
    customerId: api.customer_id,
    customerName: api.customer_name,
    planId: api.plan_id,
    planName: api.plan_name,
    status: api.status as MockSubscription["status"],
    amountCents,
    currency: api.currency,
    billingInterval: api.billing_interval as MockSubscription["billingInterval"],
    startDate: api.start_date,
    nextBillingDate: api.next_billing_date,
    cancelledDate: api.cancelled_date,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SubStatus = MockSubscription["status"];

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
type ActionKind = "activate" | "pause" | "resume" | "close" | "confirm";

interface PendingAction {
  kind: ActionKind;
  sub: MockSubscription;
}

const ACTION_CONFIG: Record<
  ActionKind,
  { title: string; description: (ref: string) => string; confirmLabel: string; destructive: boolean; endpoint: string }
> = {
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
};

// Timeline events derived from subscription data
interface TimelineEvent {
  date: string;
  label: string;
  colour: string;
}

function buildTimeline(sub: MockSubscription): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { date: sub.startDate, label: "Subscription created", colour: "bg-green-500" },
  ];
  if (sub.status === "active") {
    events.push({ date: sub.startDate, label: "Activated", colour: "bg-blue-500" });
  }
  if (sub.status === "confirmed") {
    events.push({ date: sub.startDate, label: "Confirmed", colour: "bg-blue-400" });
  }
  if (sub.status === "quotation" || sub.status === "draft") {
    events.push({ date: sub.startDate, label: "Awaiting confirmation", colour: "bg-yellow-500" });
  }
  if (sub.status === "paused") {
    events.push({ date: sub.startDate, label: "Paused", colour: "bg-sky-500" });
  }
  if (sub.cancelledDate) {
    events.push({ date: sub.cancelledDate, label: "Closed", colour: "bg-red-500" });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(
  onView: (sub: MockSubscription) => void
): ColumnDef<MockSubscription>[] {
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
      key: "amountCents",
      header: "Amount",
      cell: (row) => (
        <span className="tabular-nums">
          {formatCents(row.amountCents, row.currency)}
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
  const [subs, setSubs] = useState<MockSubscription[]>(MOCK_SUBSCRIPTIONS);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const [statusFilter, setStatusFilter] = useState<SubStatus | "all">("all");
  const [selectedSub, setSelectedSub] = useState<MockSubscription | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Fetch from API ───────────────────────────────────────────────────────
  const fetchSubs = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = getSupabaseToken();
      const qs = buildQuery({ status: statusFilter === "all" ? undefined : statusFilter, limit: 100 });
      const { data } = await apiClient.get<ApiSubscription[]>(
        `/subscriptions${qs}`,
        token ? { token } : undefined
      );
      if (data && Array.isArray(data)) {
        setSubs(data.map(adaptSubscription));
        setUsingMock(false);
      }
    } catch {
      // Backend unavailable — fall back to mock data silently
      setSubs(MOCK_SUBSCRIPTIONS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const filteredSubs = useMemo(
    () =>
      statusFilter === "all" || !usingMock
        ? subs
        : subs.filter((s) => s.status === statusFilter),
    [subs, statusFilter, usingMock]
  );

  const stats = useMemo(() => {
    const active = subs.filter((s) => s.status === "active").length;
    const confirmed = subs.filter((s) => s.status === "confirmed").length;
    const paused = subs.filter((s) => s.status === "paused").length;
    const mrr = subs
      .filter((s) => s.status === "active" && s.billingInterval === "monthly")
      .reduce((acc, s) => acc + s.amountCents, 0);
    const annualAsMrr = subs
      .filter((s) => s.status === "active" && s.billingInterval === "annual")
      .reduce((acc, s) => acc + Math.round(s.amountCents / 12), 0);
    return { active, confirmed, paused, mrr: mrr + annualAsMrr };
  }, [subs]);

  // ── Mutations (API with local fallback) ──────────────────────────────────
  async function applyAction(action: ActionKind, id: string) {
    setActionLoading(true);
    setActionError(null);

    if (!usingMock) {
      try {
        const token = getSupabaseToken();
        await apiClient.post(
          `/subscriptions/${id}/${ACTION_CONFIG[action].endpoint}`,
          {},
          token ? { token } : undefined
        );
        // Re-fetch to get the canonical updated state
        await fetchSubs();
        setPendingAction(null);
        setSelectedSub(null);
        setActionLoading(false);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Action failed";
        setActionError(msg);
        setActionLoading(false);
        return;
      }
    }

    // Mock fallback — update local state
    const nextStatus: Record<ActionKind, SubStatus> = {
      confirm: "confirmed",
      activate: "active",
      pause: "paused",
      resume: "active",
      close: "closed",
    };
    setSubs((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: nextStatus[action],
              cancelledDate:
                action === "close"
                  ? new Date().toISOString().slice(0, 10)
                  : s.cancelledDate,
              nextBillingDate:
                action === "close" ? null : s.nextBillingDate,
            }
          : s
      )
    );
    setSelectedSub((prev) =>
      prev?.id === id ? { ...prev, status: nextStatus[action] } : prev
    );
    setPendingAction(null);
    setActionLoading(false);
  }

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = useMemo(() => buildColumns(setSelectedSub), []);

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
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" />
              Demo data
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSubs}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* API error banner */}
      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {actionError}
          <button
            className="ml-auto text-xs underline"
            onClick={() => setActionError(null)}
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
          value={formatDecimalInr(String(stats.mrr / 100))}
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
        <DataTable<MockSubscription>
          columns={columns}
          data={filteredSubs}
          rowKey="id"
          pageSize={8}
          searchPlaceholder="Search by customer, plan, reference…"
          searchKeys={["customerName", "planName", "reference", "status"]}
          emptyMessage={loading ? "Loading…" : "No subscriptions match the current filter."}
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
        onClose={() => setSelectedSub(null)}
        onAction={(kind, sub) => setPendingAction({ kind, sub })}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription detail drawer (slide-in panel using Dialog)
// ---------------------------------------------------------------------------

interface DrawerProps {
  sub: MockSubscription | null;
  onClose: () => void;
  onAction: (kind: ActionKind, sub: MockSubscription) => void;
}

function SubscriptionDrawer({ sub, onClose, onAction }: DrawerProps) {
  if (!sub) return null;

  const timeline = buildTimeline(sub);

  const availableActions: ActionKind[] = (() => {
    switch (sub.status) {
      case "draft":
      case "quotation": return ["confirm", "close"];
      case "confirmed": return ["activate", "close"];
      case "active": return ["pause", "close"];
      case "paused": return ["resume", "close"];
      default: return [];
    }
  })();

  const actionIcons: Partial<Record<ActionKind, React.ReactNode>> = {
    confirm: <CheckCircle2 className="size-3.5" />,
    activate: <PlayCircle className="size-3.5" />,
    pause: <PauseCircle className="size-3.5" />,
    resume: <PlayCircle className="size-3.5" />,
    close: <XCircle className="size-3.5" />,
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
                value={`${formatCents(sub.amountCents, sub.currency)} / ${sub.billingInterval}`}
              />
              <DetailRow label="Interval" value={formatLabel(sub.billingInterval)} />
              <DetailRow label="Start date" value={formatDate(sub.startDate)} />
              <DetailRow
                label="Next billing"
                value={formatDate(sub.nextBillingDate)}
              />
              {sub.cancelledDate && (
                <DetailRow
                  label="Closed on"
                  value={formatDate(sub.cancelledDate)}
                />
              )}
            </dl>

            {/* Status timeline */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Timeline
              </h3>
              <ol className="space-y-2">
                {timeline.map((ev, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span
                      className={cn(
                        "mt-1 size-2.5 shrink-0 rounded-full",
                        ev.colour
                      )}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="leading-tight">{ev.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(ev.date)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Footer actions */}
          {availableActions.length > 0 && (
            <div className="border-t border-border px-5 py-4 flex flex-wrap gap-2">
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
          )}
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

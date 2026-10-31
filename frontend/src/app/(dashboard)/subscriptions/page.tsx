"use client";

import { useState, useMemo } from "react";
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
import { formatCents, formatDate, formatLabel } from "@/lib/format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SubStatus = MockSubscription["status"];

const STATUS_FILTER_OPTIONS: { label: string; value: SubStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Overdue", value: "overdue" },
  { label: "Cancelled", value: "cancelled" },
];

type ActionKind = "confirm" | "pause" | "resume" | "cancel";

interface PendingAction {
  kind: ActionKind;
  sub: MockSubscription;
}

const ACTION_CONFIG: Record<
  ActionKind,
  { title: string; description: (ref: string) => string; confirmLabel: string; destructive: boolean }
> = {
  confirm: {
    title: "Confirm subscription",
    description: (ref) =>
      `Activate ${ref} immediately. The customer will be billed on the next billing date.`,
    confirmLabel: "Confirm subscription",
    destructive: false,
  },
  pause: {
    title: "Pause subscription",
    description: (ref) =>
      `Pause ${ref}. No invoices will be generated while the subscription is paused.`,
    confirmLabel: "Pause",
    destructive: false,
  },
  resume: {
    title: "Resume subscription",
    description: (ref) =>
      `Resume ${ref}. Billing will restart on the next billing cycle.`,
    confirmLabel: "Resume",
    destructive: false,
  },
  cancel: {
    title: "Cancel subscription",
    description: (ref) =>
      `Cancel ${ref} at end of the current period. This action cannot be undone.`,
    confirmLabel: "Cancel subscription",
    destructive: true,
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
  if (sub.status === "active" || sub.status === "overdue") {
    events.push({
      date: sub.startDate,
      label: "Activated",
      colour: "bg-blue-500",
    });
  }
  if (sub.status === "pending") {
    events.push({
      date: sub.startDate,
      label: "Awaiting confirmation",
      colour: "bg-yellow-500",
    });
  }
  if (sub.status === "overdue") {
    events.push({
      date: sub.nextBillingDate ?? sub.startDate,
      label: "Payment overdue",
      colour: "bg-orange-500",
    });
  }
  if (sub.cancelledDate) {
    events.push({
      date: sub.cancelledDate,
      label: "Cancelled",
      colour: "bg-red-500",
    });
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
  const [statusFilter, setStatusFilter] = useState<SubStatus | "all">("all");
  const [selectedSub, setSelectedSub] = useState<MockSubscription | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────
  const filteredSubs = useMemo(
    () =>
      statusFilter === "all"
        ? subs
        : subs.filter((s) => s.status === statusFilter),
    [subs, statusFilter]
  );

  const stats = useMemo(() => {
    const active = subs.filter((s) => s.status === "active").length;
    const pending = subs.filter((s) => s.status === "pending").length;
    const overdue = subs.filter((s) => s.status === "overdue").length;
    const mrr = subs
      .filter((s) => s.status === "active" && s.billingInterval === "monthly")
      .reduce((acc, s) => acc + s.amountCents, 0);
    const annualAsMrr = subs
      .filter((s) => s.status === "active" && s.billingInterval === "annual")
      .reduce((acc, s) => acc + Math.round(s.amountCents / 12), 0);
    return { active, pending, overdue, mrr: mrr + annualAsMrr };
  }, [subs]);

  // ── Mutations (local mock state only) ───────────────────────────────────
  function applyAction(action: ActionKind, id: string) {
    const nextStatus: Record<ActionKind, SubStatus> = {
      confirm: "active",
      pause: "pending",
      resume: "active",
      cancel: "cancelled",
    };
    setSubs((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: nextStatus[action],
              cancelledDate:
                action === "cancel"
                  ? new Date().toISOString().slice(0, 10)
                  : s.cancelledDate,
              nextBillingDate:
                action === "cancel" ? null : s.nextBillingDate,
            }
          : s
      )
    );
    // Refresh the detail drawer if open
    setSelectedSub((prev) =>
      prev?.id === id ? { ...prev, status: nextStatus[action] } : prev
    );
    setPendingAction(null);
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
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          Demo data — actions are local only
        </span>
      </div>

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
          value={formatCents(stats.mrr, "USD")}
          icon={CreditCard}
          description="Monthly recurring revenue"
        />
        <StatCard
          title="Pending"
          value={stats.pending}
          icon={Clock}
          trend={{ direction: "neutral", label: "awaiting confirmation" }}
        />
        <StatCard
          title="Overdue"
          value={stats.overdue}
          icon={AlertCircle}
          trend={stats.overdue > 0 ? { direction: "down", label: "need attention" } : undefined}
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
          emptyMessage="No subscriptions match the current filter."
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
          onOpenChange={(open) => { if (!open) setPendingAction(null); }}
          title={ACTION_CONFIG[pendingAction.kind].title}
          description={ACTION_CONFIG[pendingAction.kind].description(
            pendingAction.sub.reference
          )}
          confirmLabel={ACTION_CONFIG[pendingAction.kind].confirmLabel}
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
      case "pending": return ["confirm", "cancel"];
      case "active": return ["pause", "cancel"];
      case "overdue": return ["cancel"];
      default: return [];
    }
  })();

  const actionIcons: Partial<Record<ActionKind, React.ReactNode>> = {
    confirm: <PlayCircle className="size-3.5" />,
    pause: <PauseCircle className="size-3.5" />,
    resume: <PlayCircle className="size-3.5" />,
    cancel: <XCircle className="size-3.5" />,
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
                  label="Cancelled on"
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
                  variant={kind === "cancel" ? "destructive" : "outline"}
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

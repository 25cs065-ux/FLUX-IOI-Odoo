"use client";

import { useState, useMemo } from "react";
import {
  CalendarDays,
  CreditCard,
  Eye,
  PauseCircle,
  RefreshCw,
  XCircle,
  X,
} from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DEMO_CUSTOMER } from "@/mocks/demo-customer";
import { MOCK_SUBSCRIPTIONS, type MockSubscription } from "@/mocks/subscriptions";
import { formatInrCentsFull, formatDate, formatLabel } from "@/lib/format";

// ---------------------------------------------------------------------------
// Customer actions — these are requests, not direct admin actions
// ---------------------------------------------------------------------------

type RequestKind = "change_plan" | "pause" | "cancel";

interface PendingRequest {
  kind: RequestKind;
  sub: MockSubscription;
}

const REQUEST_CONFIG: Record<
  RequestKind,
  {
    title: string;
    description: (ref: string) => string;
    confirmLabel: string;
    destructive: boolean;
    nextStatus: MockSubscription["status"];
  }
> = {
  change_plan: {
    title: "Request plan change",
    description: (ref) =>
      `Submit a request to change the plan for ${ref}. Our team will review and contact you within 1 business day.`,
    confirmLabel: "Submit request",
    destructive: false,
    nextStatus: "pending",
  },
  pause: {
    title: "Request subscription pause",
    description: (ref) =>
      `Submit a pause request for ${ref}. Billing will be suspended once approved. This is a demo — no request is sent.`,
    confirmLabel: "Submit pause request",
    destructive: false,
    nextStatus: "pending",
  },
  cancel: {
    title: "Request cancellation",
    description: (ref) =>
      `Submit a cancellation request for ${ref}. Your subscription will remain active until the current period ends. This is a demo — no request is sent.`,
    confirmLabel: "Request cancellation",
    destructive: true,
    nextStatus: "cancelled",
  },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortalSubscriptionsPage() {
  const initialSubs = useMemo(
    () => MOCK_SUBSCRIPTIONS.filter((s) => s.customerId === DEMO_CUSTOMER.id),
    []
  );

  const [subs, setSubs] = useState<MockSubscription[]>(initialSubs);
  const [selectedSub, setSelectedSub] = useState<MockSubscription | null>(null);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);

  function applyRequest(kind: RequestKind, id: string) {
    const nextStatus = REQUEST_CONFIG[kind].nextStatus;
    setSubs((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: nextStatus,
              cancelledDate:
                kind === "cancel"
                  ? new Date().toISOString().slice(0, 10)
                  : s.cancelledDate,
              nextBillingDate:
                kind === "cancel" ? null : s.nextBillingDate,
            }
          : s
      )
    );
    setSelectedSub((prev) =>
      prev?.id === id ? { ...prev, status: nextStatus } : prev
    );
    setPendingRequest(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Subscriptions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your active plans and billing
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          Demo — requests are local only
        </span>
      </div>

      {/* Subscription cards */}
      {subs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          You have no subscriptions yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subs.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              onView={setSelectedSub}
              onRequest={(kind) => setPendingRequest({ kind, sub })}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <SubscriptionDetailDrawer
        sub={selectedSub}
        onClose={() => setSelectedSub(null)}
        onRequest={(kind, sub) => setPendingRequest({ kind, sub })}
      />

      {/* Confirm request dialog */}
      {pendingRequest && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setPendingRequest(null); }}
          title={REQUEST_CONFIG[pendingRequest.kind].title}
          description={REQUEST_CONFIG[pendingRequest.kind].description(
            pendingRequest.sub.reference
          )}
          confirmLabel={REQUEST_CONFIG[pendingRequest.kind].confirmLabel}
          destructive={REQUEST_CONFIG[pendingRequest.kind].destructive}
          onConfirm={() =>
            applyRequest(pendingRequest.kind, pendingRequest.sub.id)
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription card (summary tile)
// ---------------------------------------------------------------------------

interface CardProps {
  sub: MockSubscription;
  onView: (sub: MockSubscription) => void;
  onRequest: (kind: RequestKind) => void;
}

function SubscriptionCard({ sub, onView, onRequest }: CardProps) {
  const isManageable =
    sub.status === "active" || sub.status === "pending";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Plan name + status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{sub.planName} Plan</p>
          <p className="font-mono text-xs text-muted-foreground">{sub.reference}</p>
        </div>
        <StatusBadge status={sub.status} />
      </div>

      {/* Amount */}
      <p className="text-xl font-semibold tabular-nums">
        {formatInrCentsFull(sub.amountCents)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          /{sub.billingInterval}
        </span>
      </p>

      {/* Dates */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Started</dt>
        <dd>{formatDate(sub.startDate)}</dd>
        <dt>Next billing</dt>
        <dd
          className={cn(
            sub.status === "overdue" && "text-orange-600 dark:text-orange-400 font-medium"
          )}
        >
          {formatDate(sub.nextBillingDate)}
        </dd>
      </dl>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onView(sub)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
        >
          <Eye className="size-3" />
          Details
        </button>
        {isManageable && (
          <>
            <button
              onClick={() => onRequest("pause")}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
            >
              <PauseCircle className="size-3" />
              Pause
            </button>
            <button
              onClick={() => onRequest("cancel")}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-destructive hover:bg-destructive/10 transition-colors"
            >
              <XCircle className="size-3" />
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription detail drawer
// ---------------------------------------------------------------------------

interface DrawerProps {
  sub: MockSubscription | null;
  onClose: () => void;
  onRequest: (kind: RequestKind, sub: MockSubscription) => void;
}

function SubscriptionDetailDrawer({ sub, onClose, onRequest }: DrawerProps) {
  if (!sub) return null;

  const isManageable = sub.status === "active" || sub.status === "pending";

  return (
    <Dialog.Root open modal onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" />
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
                {sub.planName} Plan
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {sub.reference}
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
            <StatusBadge status={sub.status} />

            {/* Amount */}
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">
                {formatInrCentsFull(sub.amountCents)}
              </p>
              <p className="text-sm text-muted-foreground">
                per {sub.billingInterval}
              </p>
            </div>

            {/* Details */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium">{sub.planName}</dd>
              <dt className="text-muted-foreground">Interval</dt>
              <dd>{formatLabel(sub.billingInterval)}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatDate(sub.startDate)}</dd>
              <dt className="text-muted-foreground">Next billing</dt>
              <dd
                className={cn(
                  sub.status === "overdue" &&
                    "text-orange-600 dark:text-orange-400 font-medium"
                )}
              >
                {formatDate(sub.nextBillingDate)}
              </dd>
              {sub.cancelledDate && (
                <>
                  <dt className="text-muted-foreground">Cancelled</dt>
                  <dd className="text-destructive">
                    {formatDate(sub.cancelledDate)}
                  </dd>
                </>
              )}
            </dl>

            {/* Renewal notice */}
            {sub.status === "active" && sub.nextBillingDate && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                Your next renewal is on {formatDate(sub.nextBillingDate)}.
              </div>
            )}
          </div>

          {/* Footer actions */}
          {isManageable && (
            <div className="border-t border-border px-5 py-4 flex flex-wrap gap-2">
              <button
                onClick={() => onRequest("change_plan", sub)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
              >
                <RefreshCw className="size-3.5" />
                Request plan change
              </button>
              <button
                onClick={() => onRequest("pause", sub)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
              >
                <PauseCircle className="size-3.5" />
                Request pause
              </button>
              <button
                onClick={() => onRequest("cancel", sub)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border text-destructive hover:bg-destructive/10 transition-colors"
              >
                <XCircle className="size-3.5" />
                Request cancellation
              </button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

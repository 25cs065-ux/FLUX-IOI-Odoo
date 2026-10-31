"use client";

import { useState, useMemo, useEffect } from "react";
import {
  CalendarDays,
  Eye,
  CheckCircle2,
  X,
  WifiOff,
} from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DEMO_CUSTOMER } from "@/mocks/demo-customer";
import { MOCK_SUBSCRIPTIONS, type MockSubscription } from "@/mocks/subscriptions";
import { formatInrCentsFull, formatDate, formatLabel } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiSubscription } from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

function adaptSubscription(api: ApiSubscription): MockSubscription {
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
// Page — customer portal (read-only + confirm own quotation)
// ---------------------------------------------------------------------------

export default function PortalSubscriptionsPage() {
  const [subs, setSubs] = useState<MockSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [selectedSub, setSelectedSub] = useState<MockSubscription | null>(null);
  const [confirmingSub, setConfirmingSub] = useState<MockSubscription | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // ── Fetch subscriptions (backend enforces customer isolation) ─────────────
  useEffect(() => {
    async function load() {
      try {
        const token = getSupabaseToken();
        const { data } = await apiClient.get<ApiSubscription[]>(
          "/subscriptions?limit=100",
          token ? { token } : undefined
        );
        if (data && Array.isArray(data)) {
          setSubs(data.map(adaptSubscription));
          setUsingMock(false);
        }
      } catch {
        // Fall back to mock data filtered by demo customer id
        setSubs(MOCK_SUBSCRIPTIONS.filter((s) => s.customerId === DEMO_CUSTOMER.id));
        setUsingMock(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Confirm quotation (the only write action customers can perform) ───────
  async function confirmSubscription(sub: MockSubscription) {
    setConfirmError(null);

    if (!usingMock) {
      try {
        const token = getSupabaseToken();
        await apiClient.post(
          `/subscriptions/${sub.id}/confirm`,
          {},
          token ? { token } : undefined
        );
        // Refresh
        setSubs((prev) =>
          prev.map((s) => (s.id === sub.id ? { ...s, status: "confirmed" } : s))
        );
        setSelectedSub((prev) =>
          prev?.id === sub.id ? { ...prev, status: "confirmed" } : prev
        );
      } catch (err) {
        setConfirmError(err instanceof Error ? err.message : "Confirm failed");
      }
    } else {
      // Mock fallback
      setSubs((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, status: "confirmed" } : s))
      );
      setSelectedSub((prev) =>
        prev?.id === sub.id ? { ...prev, status: "confirmed" } : prev
      );
    }
    setConfirmingSub(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Subscriptions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            View your active plans and billing
          </p>
        </div>
        {usingMock && (
          <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <WifiOff className="size-3" />
            Demo data
          </span>
        )}
      </div>

      {/* Error banner */}
      {confirmError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-2">
          {confirmError}
          <button className="text-xs underline shrink-0" onClick={() => setConfirmError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Subscription cards */}
      {loading ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading your subscriptions…
        </div>
      ) : subs.length === 0 ? (
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
              onConfirm={() => setConfirmingSub(sub)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <SubscriptionDetailDrawer
        sub={selectedSub}
        onClose={() => setSelectedSub(null)}
        onConfirm={(sub) => setConfirmingSub(sub)}
      />

      {/* Confirm quotation dialog */}
      {confirmingSub && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirmingSub(null); }}
          title="Confirm subscription"
          description={`Confirm ${confirmingSub.reference}. This accepts the quoted terms and moves the subscription to confirmed status.`}
          confirmLabel="Confirm subscription"
          destructive={false}
          onConfirm={() => confirmSubscription(confirmingSub)}
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
  onConfirm: () => void;
}

function SubscriptionCard({ sub, onView, onConfirm }: CardProps) {
  const isQuotation = sub.status === "quotation" || sub.status === "draft";

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
        <dd>{formatDate(sub.nextBillingDate)}</dd>
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
        {isQuotation && (
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <CheckCircle2 className="size-3" />
            Confirm
          </button>
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
  onConfirm: (sub: MockSubscription) => void;
}

function SubscriptionDetailDrawer({ sub, onClose, onConfirm }: DrawerProps) {
  if (!sub) return null;

  const isQuotation = sub.status === "quotation" || sub.status === "draft";

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
              <dd>{formatDate(sub.nextBillingDate)}</dd>
              {sub.cancelledDate && (
                <>
                  <dt className="text-muted-foreground">Closed</dt>
                  <dd className="text-destructive">{formatDate(sub.cancelledDate)}</dd>
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

            {/* Quotation notice */}
            {isQuotation && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                <CheckCircle2 className="size-3.5 shrink-0" />
                This subscription is a quotation. Review the terms and confirm to activate billing.
              </div>
            )}
          </div>

          {/* Footer — only show confirm for quotations */}
          {isQuotation && (
            <div className="border-t border-border px-5 py-4">
              <button
                onClick={() => onConfirm(sub)}
                className="flex items-center justify-center gap-1.5 w-full rounded-md px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <CheckCircle2 className="size-4" />
                Confirm subscription
              </button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

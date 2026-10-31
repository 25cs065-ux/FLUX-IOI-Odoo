"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  Eye,
  Send,
  Printer,
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
import { MOCK_INVOICES, type MockInvoice } from "@/mocks/invoices";
import { formatCents, formatDate, formatDecimalInr } from "@/lib/format";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiInvoice } from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter — map backend response to the shape the UI expects
// ---------------------------------------------------------------------------

function adaptInvoice(api: ApiInvoice): MockInvoice {
  const totalCents = Math.round(parseFloat(api.total_amount) * 100);
  const paidCents = Math.round(parseFloat(api.paid_amount) * 100);
  return {
    id: api.id,
    invoiceNumber: api.invoice_number,
    customerId: api.customer_id,
    customerName: api.customer_name,
    subscriptionId: api.subscription_id ?? null,
    status: api.status as MockInvoice["status"],
    totalCents,
    paidCents,
    currency: api.currency,
    issuedDate: api.issued_date ?? "",
    dueDate: api.due_date ?? "",
    paidDate: api.paid_date ?? null,
  };
}

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type InvStatus = MockInvoice["status"];

const STATUS_FILTER_OPTIONS: { label: string; value: InvStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Sent", value: "sent" },
  { label: "Partial", value: "partial" },
  { label: "Paid", value: "paid" },
  { label: "Overdue", value: "overdue" },
  { label: "Void", value: "void" },
  { label: "Cancelled", value: "cancelled" },
];

// Backend-aligned actions. "confirm" is replaced by "send" (draft → sent).
type ActionKind = "send" | "cancel" | "void" | "print";

interface PendingAction {
  kind: ActionKind;
  invoice: MockInvoice;
}

const ACTION_CONFIG: Record<
  ActionKind,
  {
    title: string;
    description: (num: string) => string;
    confirmLabel: string;
    destructive: boolean;
    needsConfirm: boolean;
    endpoint?: string;
  }
> = {
  send: {
    title: "Send invoice",
    description: (n) =>
      `Send ${n} to the customer — moves status from draft to sent.`,
    confirmLabel: "Send invoice",
    destructive: false,
    needsConfirm: true,
    endpoint: "send",
  },
  cancel: {
    title: "Cancel invoice",
    description: (n) =>
      `Cancel ${n}. This cannot be undone.`,
    confirmLabel: "Cancel invoice",
    destructive: true,
    needsConfirm: true,
    endpoint: "cancel",
  },
  void: {
    title: "Void invoice",
    description: (n) =>
      `Void ${n}. Only allowed when the invoice has been sent or is overdue with no payments recorded.`,
    confirmLabel: "Void invoice",
    destructive: true,
    needsConfirm: true,
    endpoint: "void",
  },
  print: {
    title: "Print / download",
    description: (n) => `Download a PDF copy of ${n}.`,
    confirmLabel: "Download PDF",
    destructive: false,
    needsConfirm: false,
  },
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(
  onView: (inv: MockInvoice) => void
): ColumnDef<MockInvoice>[] {
  return [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row) => (
        <span className="font-mono text-xs font-medium">{row.invoiceNumber}</span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row) => <span className="font-medium">{row.customerName}</span>,
    },
    {
      key: "issuedDate",
      header: "Issued",
      cell: (row) => formatDate(row.issuedDate),
      hideOnMobile: true,
    },
    {
      key: "dueDate",
      header: "Due",
      cell: (row) => (
        <span
          className={cn(
            row.status === "overdue"
              ? "text-orange-600 dark:text-orange-400 font-medium"
              : ""
          )}
        >
          {formatDate(row.dueDate)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "totalCents",
      header: "Amount",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {formatCents(row.totalCents, row.currency)}
        </span>
      ),
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
          aria-label={`View ${row.invoiceNumber}`}
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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<MockInvoice[]>(MOCK_INVOICES);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  const [statusFilter, setStatusFilter] = useState<InvStatus | "all">("all");
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Fetch from API ───────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ status: statusFilter === "all" ? undefined : statusFilter, limit: 100 });
      const { data } = await apiClient.get<ApiInvoice[]>(
        `/invoices${qs}`,
        token ? { token } : undefined
      );
      if (data && Array.isArray(data)) {
        setInvoices(data.map(adaptInvoice));
        setUsingMock(false);
      }
    } catch {
      setInvoices(MOCK_INVOICES);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredInvoices = useMemo(
    () =>
      statusFilter === "all" || !usingMock
        ? invoices
        : invoices.filter((i) => i.status === statusFilter),
    [invoices, statusFilter, usingMock]
  );

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = invoices.reduce((acc, i) => acc + i.totalCents, 0);
    // "sent" is the backend equivalent of old "pending"
    const outstanding = invoices
      .filter((i) => i.status === "sent" || i.status === "partial" || i.status === "draft")
      .reduce((acc, i) => acc + (i.totalCents - i.paidCents), 0);
    const overdue = invoices
      .filter((i) => i.status === "overdue")
      .reduce((acc, i) => acc + i.totalCents, 0);
    const paidCount = invoices.filter((i) => i.status === "paid").length;
    return { total, outstanding, overdue, paidCount };
  }, [invoices]);

  // ── Mutations ────────────────────────────────────────────────────────────
  async function applyAction(kind: ActionKind, id: string) {
    if (kind === "print") {
      alert("PDF download is not available yet.");
      setPendingAction(null);
      return;
    }

    setActionLoading(true);
    setActionError(null);

    const cfg = ACTION_CONFIG[kind];
    if (!usingMock && cfg.endpoint) {
      try {
        const token = await getSupabaseToken();
        await apiClient.post(
          `/invoices/${id}/${cfg.endpoint}`,
          {},
          token ? { token } : undefined
        );
        await fetchInvoices();
        setPendingAction(null);
        setSelectedInvoice(null);
        setActionLoading(false);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Action failed";
        setActionError(msg);
        setActionLoading(false);
        return;
      }
    }

    // Mock fallback
    const nextStatus: Partial<Record<ActionKind, InvStatus>> = {
      send: "sent",
      cancel: "cancelled",
      void: "void",
    };
    if (nextStatus[kind]) {
      setInvoices((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: nextStatus[kind]! } : i
        )
      );
      setSelectedInvoice((prev) =>
        prev?.id === id ? { ...prev, status: nextStatus[kind]! } : prev
      );
    }
    setPendingAction(null);
    setActionLoading(false);
  }

  const columns = useMemo(() => buildColumns(setSelectedInvoice), []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Track and manage customer invoices
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" />
              Demo data
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchInvoices} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {actionError}
          <button className="ml-auto text-xs underline" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Total invoiced"
          value={formatDecimalInr(String(stats.total / 100))}
          icon={FileText}
          description={`${invoices.length} invoices`}
        />
        <StatCard
          title="Outstanding"
          value={formatDecimalInr(String(stats.outstanding / 100))}
          icon={Clock}
          trend={{ direction: "neutral", label: "awaiting payment" }}
        />
        <StatCard
          title="Overdue"
          value={formatDecimalInr(String(stats.overdue / 100))}
          icon={AlertCircle}
          trend={
            stats.overdue > 0
              ? { direction: "down", label: "requires action" }
              : { direction: "neutral", label: "none overdue" }
          }
        />
        <StatCard
          title="Paid invoices"
          value={stats.paidCount}
          icon={CheckCircle2}
          trend={{ direction: "up", label: "this period" }}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<MockInvoice>
          columns={columns}
          data={filteredInvoices}
          rowKey="id"
          pageSize={8}
          searchPlaceholder="Search by invoice #, customer…"
          searchKeys={["invoiceNumber", "customerName", "status"]}
          emptyMessage={loading ? "Loading…" : "No invoices match the current filter."}
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

      {/* Detail drawer */}
      <InvoiceDrawer
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onAction={(kind, inv) => setPendingAction({ kind, invoice: inv })}
      />

      {/* Confirm dialog */}
      {pendingAction && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) { setPendingAction(null); setActionError(null); } }}
          title={ACTION_CONFIG[pendingAction.kind].title}
          description={ACTION_CONFIG[pendingAction.kind].description(
            pendingAction.invoice.invoiceNumber
          )}
          confirmLabel={actionLoading ? "Working…" : ACTION_CONFIG[pendingAction.kind].confirmLabel}
          destructive={ACTION_CONFIG[pendingAction.kind].destructive}
          onConfirm={() =>
            applyAction(pendingAction.kind, pendingAction.invoice.id)
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail drawer
// ---------------------------------------------------------------------------

interface InvoiceDrawerProps {
  invoice: MockInvoice | null;
  onClose: () => void;
  onAction: (kind: ActionKind, invoice: MockInvoice) => void;
}

function InvoiceDrawer({ invoice, onClose, onAction }: InvoiceDrawerProps) {
  if (!invoice) return null;

  // Actions available per backend status
  const availableActions: ActionKind[] = (() => {
    switch (invoice.status) {
      case "draft": return ["send", "cancel"];
      case "sent":
      case "overdue": return ["void"];
      case "paid": return ["print"];
      default: return [];
    }
  })();

  const actionIcons: Partial<Record<ActionKind, React.ReactNode>> = {
    send: <Send className="size-3.5" />,
    cancel: <X className="size-3.5" />,
    void: <X className="size-3.5" />,
    print: <Printer className="size-3.5" />,
  };

  const balanceDue = invoice.totalCents - invoice.paidCents;

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
                {invoice.invoiceNumber}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {invoice.customerName}
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
            <div className="flex items-center gap-2">
              <StatusBadge status={invoice.status} />
            </div>

            {/* Amount summary */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums">
                  {formatCents(invoice.totalCents, invoice.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular-nums text-green-600 dark:text-green-400">
                  {formatCents(invoice.paidCents, invoice.currency)}
                </span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span>Balance due</span>
                <span
                  className={cn(
                    "tabular-nums",
                    balanceDue > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
                  )}
                >
                  {formatCents(balanceDue, invoice.currency)}
                </span>
              </div>
            </div>

            {/* Detail grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="font-medium">{invoice.customerName}</dd>

              <dt className="text-muted-foreground">Issued</dt>
              <dd>{formatDate(invoice.issuedDate)}</dd>

              <dt className="text-muted-foreground">Due</dt>
              <dd
                className={cn(
                  invoice.status === "overdue"
                    ? "font-medium text-orange-600 dark:text-orange-400"
                    : ""
                )}
              >
                {formatDate(invoice.dueDate)}
              </dd>

              {invoice.paidDate && (
                <>
                  <dt className="text-muted-foreground">Paid on</dt>
                  <dd className="font-medium text-green-600 dark:text-green-400">
                    {formatDate(invoice.paidDate)}
                  </dd>
                </>
              )}

              {invoice.subscriptionId && (
                <>
                  <dt className="text-muted-foreground">Subscription</dt>
                  <dd className="font-mono text-xs">{invoice.subscriptionId}</dd>
                </>
              )}
            </dl>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <DollarSign className="size-3.5 shrink-0" />
              PDF download is not yet implemented on the backend.
            </div>
          </div>

          {/* Footer actions */}
          {availableActions.length > 0 && (
            <div className="border-t border-border px-5 py-4 flex flex-wrap gap-2">
              {availableActions.map((kind) => (
                <Button
                  key={kind}
                  variant={kind === "cancel" || kind === "void" ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => onAction(kind, invoice)}
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

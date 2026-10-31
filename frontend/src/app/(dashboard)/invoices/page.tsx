"use client";

import { useState, useMemo, useEffect, useCallback, type FormEvent } from "react";
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Eye,
  Send,
  X,
  RefreshCw,
  Plus,
  Play,
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
import { formatDate } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits } from "@/lib/money";
import { apiClient, buildQuery, clearApiCache, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type {
  ApiCustomer,
  ApiInvoice,
  ApiInvoiceSummary,
  ApiSubscriptionSummary,
  InvoiceStatus,
} from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter — map backend response to the shape the UI expects
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  subscriptionId: string | null;
  status: InvoiceStatus;
  totalAmount: string;
  paidAmount: string;
  amountDue: string;
  currency: string;
  issuedDate: string;
  dueDate: string;
  paidDate: string | null;
}

function adaptInvoice(api: ApiInvoiceSummary, customers: Map<string, ApiCustomer>): InvoiceRow {
  return {
    id: api.id,
    invoiceNumber: api.invoice_number,
    customerId: api.customer_id,
    customerName: customers.get(api.customer_id)?.name ?? api.customer_id,
    subscriptionId: api.subscription_id ?? null,
    status: api.status,
    totalAmount: api.total_amount,
    paidAmount: api.amount_paid,
    amountDue: api.amount_due,
    currency: api.currency,
    issuedDate: api.issue_date,
    dueDate: api.due_date,
    paidDate: api.paid_at,
  };
}

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type InvStatus = InvoiceStatus;

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
type ActionKind = "send" | "cancel" | "void";

interface PendingAction {
  kind: ActionKind;
  invoice: InvoiceRow;
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
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(
  onView: (inv: InvoiceRow) => void
): ColumnDef<InvoiceRow>[] {
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
      key: "totalAmount",
      header: "Amount",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {formatMinorUnits(decimalToMinorUnits(row.totalAmount), row.currency)}
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
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<InvStatus | "all">("all");
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<ApiInvoice | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [subscriptions, setSubscriptions] = useState<ApiSubscriptionSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"manual" | "generate">("manual");
  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: "",
    subscription_id: "",
    issue_date: "",
    due_date: "",
    description: "",
    unit_price: "",
    quantity: "1",
    notes: "",
  });
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  // ── Fetch from API ───────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setError(null);
      const options = token ? { token } : undefined;
      const path = `/invoices${buildQuery({ status: statusFilter === "all" ? undefined : statusFilter })}`;
      const [invoiceData, customerData, subscriptionData] = await Promise.all([
        getAllPages<ApiInvoiceSummary>(path, 200, options),
        getAllPages<ApiCustomer>("/customers/", 100, options),
        getAllPages<ApiSubscriptionSummary>("/subscriptions", 200, options),
      ]);
      setCustomers(customerData);
      setSubscriptions(subscriptionData);
      const customerMap = new Map(customerData.map((customer) => [customer.id, customer]));
      setInvoices(invoiceData.map((invoice) => adaptInvoice(invoice, customerMap)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices.");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchInvoices());
  }, [fetchInvoices]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredInvoices = invoices;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = invoices.reduce((acc, invoice) => acc + decimalToMinorUnits(invoice.totalAmount), 0n);
    const outstanding = invoices
      .filter((invoice) => ["sent", "partial", "overdue"].includes(invoice.status))
      .reduce((acc, invoice) => acc + decimalToMinorUnits(invoice.amountDue), 0n);
    const overdue = invoices
      .filter((invoice) => invoice.status === "overdue")
      .reduce((acc, invoice) => acc + decimalToMinorUnits(invoice.amountDue), 0n);
    const paidCount = invoices.filter((invoice) => invoice.status === "paid").length;
    return { total, outstanding, overdue, paidCount };
  }, [invoices]);

  const openInvoice = useCallback(async (invoice: InvoiceRow) => {
    setSelectedInvoice(invoice);
    setSelectedDetails(null);
    setError(null);
    try {
      const token = await getSupabaseToken();
      const { data } = await apiClient.get<ApiInvoice>(`/invoices/${invoice.id}`, token ? { token } : undefined);
      if (!data) throw new Error("The invoice endpoint returned no details.");
      setSelectedDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice details.");
    }
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────
  async function applyAction(kind: ActionKind, id: string) {
    setActionLoading(true);
    setActionError(null);

    try {
      const token = await getSupabaseToken();
      await apiClient.post(
        `/invoices/${id}/${ACTION_CONFIG[kind].endpoint}`,
        {},
        token ? { token } : undefined
      );
      await fetchInvoices();
      setPendingAction(null);
      setSelectedInvoice(null);
      setSelectedDetails(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function runBilling(endpoint: "billing-run" | "mark-overdue") {
    setError(null);
    setBatchMessage(null);
    try {
      const token = await getSupabaseToken();
      if (endpoint === "billing-run") {
        const { data } = await apiClient.post<{
          created: ApiInvoiceSummary[];
          recovered: { subscription_id: string; reason: string }[];
          skipped: { subscription_id: string; reason: string }[];
          failed: { subscription_id: string; reason: string }[];
        }>("/invoices/billing-run", {}, token ? { token } : undefined);
        if (!data) throw new Error("The billing run returned no results.");
        setBatchMessage(`Billing run: ${data.created.length} created, ${data.recovered.length} recovered, ${data.skipped.length} skipped, ${data.failed.length} failed.`);
      } else {
        const { data } = await apiClient.post<{ marked_overdue: string[] }>(
          "/invoices/mark-overdue",
          {},
          token ? { token } : undefined
        );
        if (!data) throw new Error("The overdue run returned no results.");
        setBatchMessage(`${data.marked_overdue.length} invoice(s) marked overdue.`);
      }
      await fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invoice operation failed.");
    }
  }

  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const token = await getSupabaseToken();
      if (createMode === "generate") {
        if (!invoiceForm.subscription_id) throw new Error("Select a subscription to generate an invoice.");
        await apiClient.post("/invoices/generate", {
          subscription_id: invoiceForm.subscription_id,
          issue_date: invoiceForm.issue_date || undefined,
        }, token ? { token } : undefined);
      } else {
        await apiClient.post("/invoices", {
          customer_id: invoiceForm.customer_id,
          subscription_id: invoiceForm.subscription_id || null,
          issue_date: invoiceForm.issue_date || null,
          due_date: invoiceForm.due_date || null,
          currency: "INR",
          notes: invoiceForm.notes || null,
          lines: [{
            description: invoiceForm.description,
            unit_price: invoiceForm.unit_price,
            quantity: invoiceForm.quantity,
          }],
        }, token ? { token } : undefined);
      }
      setCreateOpen(false);
      await fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save invoice.");
    }
  }

  const columns = useMemo(() => buildColumns(openInvoice), [openInvoice]);

  async function saveInvoiceNotes(invoiceId: string, notes: string) {
    setError(null);
    try {
      const token = await getSupabaseToken();
      await apiClient.patch(`/invoices/${invoiceId}`, { notes }, token ? { token } : undefined);
      const { data } = await apiClient.get<ApiInvoice>(`/invoices/${invoiceId}`, token ? { token } : undefined);
      if (!data) throw new Error("The updated invoice details were not returned.");
      setSelectedDetails(data);
      await fetchInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update invoice.");
    }
  }

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
          <Button size="sm" onClick={() => {
            setInvoiceForm((current) => ({
              ...current,
              issue_date: new Date().toISOString().slice(0, 10),
            }));
            setCreateMode("manual");
            setCreateOpen(true);
          }}>
            <Plus className="size-3.5" /> New invoice
          </Button>
          <Button variant="outline" size="sm" onClick={() => runBilling("billing-run")}>
            <Play className="size-3.5" /> Billing run
          </Button>
          <Button variant="outline" size="sm" onClick={() => runBilling("mark-overdue")}>
            Mark overdue
          </Button>
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchInvoices(); }} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Action error banner */}
      {(actionError || error || batchMessage) && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {actionError ?? error ?? batchMessage}
          <button className="ml-auto text-xs underline" onClick={() => { setActionError(null); setError(null); setBatchMessage(null); }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Total invoiced"
          value={formatMinorUnits(stats.total)}
          icon={FileText}
          description={`${invoices.length} invoices`}
        />
        <StatCard
          title="Outstanding"
          value={formatMinorUnits(stats.outstanding)}
          icon={Clock}
          trend={{ direction: "neutral", label: "awaiting payment" }}
        />
        <StatCard
          title="Overdue"
          value={formatMinorUnits(stats.overdue)}
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
        <DataTable<InvoiceRow>
          columns={columns}
          data={filteredInvoices}
          rowKey="id"
          pageSize={8}
          searchPlaceholder="Search by invoice #, customer…"
          searchKeys={["invoiceNumber", "customerName", "status"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load invoices." : "No invoices match the current filter."}
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
        key={`${selectedInvoice?.id ?? ""}:${selectedDetails ? "loaded" : "loading"}`}
        invoice={selectedInvoice}
        detail={selectedDetails}
        onClose={() => { setSelectedInvoice(null); setSelectedDetails(null); }}
        onAction={(kind, inv) => setPendingAction({ kind, invoice: inv })}
        onSaveNotes={saveInvoiceNotes}
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

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveInvoice} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="invoice-form-title">
            <div className="flex items-center justify-between">
              <h2 id="invoice-form-title" className="font-semibold">{createMode === "manual" ? "Create invoice" : "Generate invoice"}</h2>
              <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close" onClick={() => setCreateOpen(false)}><X className="size-4" /></button>
            </div>
            <label className="block space-y-1 text-sm"><span>Invoice type</span><select value={createMode} onChange={(event) => setCreateMode(event.target.value as "manual" | "generate")} className="h-8 w-full rounded-md border border-input bg-background px-3"><option value="manual">Manual invoice</option><option value="generate">From subscription</option></select></label>
            {createMode === "manual" ? (
              <>
                <label className="block space-y-1 text-sm"><span>Customer</span><select required value={invoiceForm.customer_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, customer_id: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3"><option value="">Select customer…</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.email})</option>)}</select></label>
                <label className="block space-y-1 text-sm"><span>Subscription (optional)</span><select value={invoiceForm.subscription_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, subscription_id: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3"><option value="">None</option>{subscriptions.filter((sub) => sub.customer_id === invoiceForm.customer_id).map((sub) => <option key={sub.id} value={sub.id}>{sub.subscription_number}</option>)}</select></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm"><span>Description</span><input required maxLength={500} value={invoiceForm.description} onChange={(event) => setInvoiceForm({ ...invoiceForm, description: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                  <label className="space-y-1 text-sm"><span>Unit price</span><input required inputMode="decimal" pattern="\\d+(\\.\\d{1,2})?" value={invoiceForm.unit_price} onChange={(event) => setInvoiceForm({ ...invoiceForm, unit_price: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                  <label className="space-y-1 text-sm"><span>Quantity</span><input required type="number" min="1" step="0.0001" value={invoiceForm.quantity} onChange={(event) => setInvoiceForm({ ...invoiceForm, quantity: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                  <label className="space-y-1 text-sm"><span>Due date</span><input type="date" value={invoiceForm.due_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, due_date: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                </div>
                <label className="block space-y-1 text-sm"><span>Notes</span><textarea maxLength={2000} value={invoiceForm.notes} onChange={(event) => setInvoiceForm({ ...invoiceForm, notes: event.target.value })} className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
              </>
            ) : (
              <label className="block space-y-1 text-sm"><span>Subscription</span><select required value={invoiceForm.subscription_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, subscription_id: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3"><option value="">Select subscription…</option>{subscriptions.filter((sub) => sub.status === "active").map((sub) => <option key={sub.id} value={sub.id}>{sub.subscription_number}</option>)}</select></label>
            )}
            <label className="block space-y-1 text-sm"><span>Issue date</span><input type="date" value={invoiceForm.issue_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, issue_date: event.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit">{createMode === "manual" ? "Create draft" : "Generate invoice"}</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail drawer
// ---------------------------------------------------------------------------

interface InvoiceDrawerProps {
  invoice: InvoiceRow | null;
  detail: ApiInvoice | null;
  onClose: () => void;
  onAction: (kind: ActionKind, invoice: InvoiceRow) => void;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
}

function InvoiceDrawer({ invoice, detail, onClose, onAction, onSaveNotes }: InvoiceDrawerProps) {
  const [notes, setNotes] = useState(detail?.notes ?? "");
  if (!invoice) return null;

  // Actions available per backend status
  const availableActions: ActionKind[] = (() => {
    switch (invoice.status) {
      case "draft": return ["send", "cancel"];
      case "sent":
      case "overdue": return ["void"];
      default: return [];
    }
  })();

  const actionIcons: Partial<Record<ActionKind, React.ReactNode>> = {
    send: <Send className="size-3.5" />,
    cancel: <X className="size-3.5" />,
    void: <X className="size-3.5" />,
  };

  const total = decimalToMinorUnits(invoice.totalAmount);
  const paid = decimalToMinorUnits(invoice.paidAmount);
  const balanceDue = decimalToMinorUnits(invoice.amountDue);

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
                  {formatMinorUnits(total, invoice.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular-nums text-green-600 dark:text-green-400">
                  {formatMinorUnits(paid, invoice.currency)}
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
                  {formatMinorUnits(balanceDue, invoice.currency)}
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

            {detail ? (
              <>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</h3>
                  <ul className="space-y-2 text-sm">
                    {detail.lines.map((line) => (
                      <li key={line.id} className="flex justify-between gap-3">
                        <span>{line.description} × {line.quantity}</span>
                        <span className="tabular-nums">{formatMinorUnits(decimalToMinorUnits(line.line_total), invoice.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <label className="block space-y-1 text-sm">
                  <span>Notes</span>
                  <textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2" />
                  <Button size="sm" variant="outline" onClick={() => onSaveNotes(invoice.id, notes)}>Save notes</Button>
                </label>
              </>
            ) : <p className="text-sm text-muted-foreground">Loading invoice details…</p>}
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

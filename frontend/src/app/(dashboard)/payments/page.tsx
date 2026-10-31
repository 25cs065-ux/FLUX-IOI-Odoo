"use client";

import { useState, useMemo, useEffect, useCallback, useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import {
  Wallet,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plus,
  X,
  RefreshCw,
  Eye,
  CheckCircle2 as ConfirmIcon,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";

import {
  DataTable,
  StatusBadge,
  StatCard,
  FormField,
  type ColumnDef,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { formatDate, formatLabel } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits } from "@/lib/money";
import { apiClient, buildQuery, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type {
  ApiCustomer,
  ApiInvoiceSummary,
  ApiPayment,
  ApiPaymentMethod,
  CreatePaymentBody,
  PaymentStatus,
} from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter — map backend payment to mock shape for table display
// ---------------------------------------------------------------------------

interface PaymentRow {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  status: PaymentStatus;
  method: ApiPaymentMethod;
  date: string;
  amount: string;
  refundedAmount: string;
  currency: string;
}

function adaptPayment(
  api: ApiPayment,
  invoices: Map<string, ApiInvoiceSummary>,
  customers: Map<string, ApiCustomer>
): PaymentRow {
  const invoice = invoices.get(api.invoice_id);
  return {
    id: api.id,
    reference: api.payment_reference,
    invoiceId: api.invoice_id,
    invoiceNumber: invoice?.invoice_number ?? api.invoice_id,
    customerId: api.customer_id,
    customerName: customers.get(api.customer_id)?.name ?? api.customer_id,
    status: api.status,
    method: api.method,
    date: api.payment_date,
    amount: api.amount,
    refundedAmount: api.refunded_amount,
    currency: api.currency,
  };
}

// ---------------------------------------------------------------------------
// Zod schema for Record Payment form — backend expects decimal string amounts
// ---------------------------------------------------------------------------

const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Please select an invoice"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount e.g. 49.00"),
  method: z.enum(
    ["bank_transfer", "credit_card", "upi", "cash", "cheque", "other"] as const,
    { error: "Please select a payment method" }
  ),
  status: z.enum(["pending", "completed"] as const, {
    error: "Please select a status",
  }),
  date: z.string().min(1, "Date is required"),
  reference: z.string().optional(),
  notes: z.string().max(500, "Notes must be 500 characters or less").optional(),
});

type RecordPaymentForm = z.infer<typeof recordPaymentSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type PayStatus = PaymentStatus;

const STATUS_FILTER_OPTIONS: { label: string; value: PayStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
  { label: "Refunded", value: "refunded" },
  { label: "Partially refunded", value: "partially_refunded" },
];

const PAYMENT_METHODS: { label: string; value: ApiPaymentMethod }[] = [
  { label: "Bank transfer", value: "bank_transfer" },
  { label: "Credit card", value: "credit_card" },
  { label: "UPI", value: "upi" },
  { label: "Cash", value: "cash" },
  { label: "Cheque", value: "cheque" },
  { label: "Other", value: "other" },
];

const METHOD_LABEL: Record<ApiPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  credit_card: "Credit card",
  upi: "UPI",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(onView: (payment: PaymentRow) => void): ColumnDef<PaymentRow>[] {
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
      key: "invoiceNumber",
      header: "Invoice",
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
      key: "amount",
      header: "Amount",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {formatMinorUnits(decimalToMinorUnits(row.amount), row.currency)}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      cell: (row) => METHOD_LABEL[row.method] ?? formatLabel(row.method),
      hideOnMobile: true,
    },
    {
      key: "date",
      header: "Date",
      cell: (row) => formatDate(row.date),
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
      cell: (row) => <Button variant="ghost" size="icon-sm" onClick={() => onView(row)} aria-label={`View payment ${row.reference}`}><Eye className="size-3.5" /></Button>,
    },
  ];
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [invoices, setInvoices] = useState<ApiInvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<PayStatus | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRow | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<ApiPayment | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  // ── Fetch from API ───────────────────────────────────────────────────────
  const fetchPayments = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setError(null);
      const options = token ? { token } : undefined;
      const path = `/payments${buildQuery({ status: statusFilter === "all" ? undefined : statusFilter })}`;
      const [paymentData, invoiceData, customerData] = await Promise.all([
        getAllPages<ApiPayment>(path, 200, options),
        getAllPages<ApiInvoiceSummary>("/invoices", 200, options),
        getAllPages<ApiCustomer>("/customers/", 100, options),
      ]);
      const invoiceMap = new Map(invoiceData.map((invoice) => [invoice.id, invoice]));
      const customerMap = new Map(customerData.map((customer) => [customer.id, customer]));
      setInvoices(invoiceData);
      setPayments(paymentData.map((payment) => adaptPayment(payment, invoiceMap, customerMap)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments.");
      setPayments([]);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchPayments());
  }, [fetchPayments]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredPayments = payments;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const collected = payments
      .filter((payment) => payment.status === "completed" || payment.status === "partially_refunded")
      .reduce((acc, payment) => acc + decimalToMinorUnits(payment.amount) - decimalToMinorUnits(payment.refundedAmount), 0n);
    const pending = payments.filter((p) => p.status === "pending").length;
    const failed = payments.filter((p) => p.status === "failed").length;
    return { collected, pending, failed, total: payments.length };
  }, [payments]);

  // ── Add new payment ────────────────────────────────────────────────────────
  async function handleRecordPayment(data: RecordPaymentForm) {
    setSubmitError(null);

    try {
      const token = await getSupabaseToken();
      const body: CreatePaymentBody = {
        invoice_id: data.invoiceId,
        amount: data.amount,
        method: data.method,
        status: data.status,
        payment_date: data.date,
        payment_reference: data.reference || undefined,
        notes: data.notes || undefined,
      };
      await apiClient.post("/payments", body, token ? { token } : undefined);
      await fetchPayments();
      setDialogOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to record payment.");
    }
  }

  const openPayment = useCallback(async (payment: PaymentRow) => {
    setSelectedPayment(payment);
    setSelectedDetails(null);
    setActionError(null);
    try {
      const token = await getSupabaseToken();
      const { data } = await apiClient.get<ApiPayment>(`/payments/${payment.id}`, token ? { token } : undefined);
      if (!data) throw new Error("The payment endpoint returned no details.");
      setSelectedDetails(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load payment details.");
    }
  }, []);

  async function paymentAction(action: "confirm" | "fail" | "refund" | "recalculate") {
    if (!selectedPayment) return;
    setActionError(null);
    try {
      const token = await getSupabaseToken();
      if (action === "recalculate") {
        await apiClient.post(`/payments/recalculate/${selectedPayment.invoiceId}`, {}, token ? { token } : undefined);
      } else {
        const body = action === "refund"
          ? { amount: refundAmount || undefined, reason: refundReason || undefined }
          : {};
        await apiClient.post(`/payments/${selectedPayment.id}/${action}`, body, token ? { token } : undefined);
      }
      await fetchPayments();
      await openPayment(selectedPayment);
      setRefundAmount("");
      setRefundReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The payment action failed.");
    }
  }

  const columns = useMemo(() => buildColumns(openPayment), [openPayment]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Payments</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Monitor and record customer payments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchPayments} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setSubmitError(null); setDialogOpen(true); }}>
            <Plus className="size-3.5" />
            Record payment
          </Button>
        </div>
      </div>

      {(error || actionError) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError ?? error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Total collected"
          value={formatMinorUnits(stats.collected)}
          icon={CheckCircle2}
          description={`${stats.total} payment records`}
          trend={{ direction: "up", label: "this period" }}
        />
        <StatCard
          title="Pending"
          value={stats.pending}
          icon={Clock}
          trend={{ direction: "neutral", label: "awaiting processing" }}
        />
        <StatCard
          title="Failed"
          value={stats.failed}
          icon={AlertCircle}
          trend={
            stats.failed > 0
              ? { direction: "down", label: "requires attention" }
              : { direction: "neutral", label: "none failed" }
          }
        />
        <StatCard
          title="Total records"
          value={stats.total}
          icon={Wallet}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<PaymentRow>
          columns={columns}
          data={filteredPayments}
          rowKey="id"
          pageSize={8}
          searchPlaceholder="Search by customer, invoice, reference…"
          searchKeys={["customerName", "invoiceNumber", "reference", "status"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load payments." : "No payments match the current filter."}
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

      {/* Record payment dialog */}
      {dialogOpen && (
        <RecordPaymentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleRecordPayment}
          submitError={submitError}
          invoices={invoices}
        />
      )}
      <PaymentDrawer
        key={selectedPayment?.id ?? ""}
        payment={selectedPayment}
        detail={selectedDetails}
        error={actionError}
        refundAmount={refundAmount}
        refundReason={refundReason}
        onRefundAmountChange={setRefundAmount}
        onRefundReasonChange={setRefundReason}
        onClose={() => { setSelectedPayment(null); setSelectedDetails(null); }}
        onAction={paymentAction}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record Payment dialog with RHF + Zod validation
// ---------------------------------------------------------------------------

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: RecordPaymentForm) => Promise<void>;
  submitError: string | null;
  invoices: ApiInvoiceSummary[];
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  onSubmit,
  submitError,
  invoices,
}: RecordPaymentDialogProps) {
  const formId = useId();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RecordPaymentForm>({
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      method: "bank_transfer",
      status: "completed",
    },
  });

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  async function onValid(raw: RecordPaymentForm) {
    const result = recordPaymentSchema.safeParse(raw);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof RecordPaymentForm | undefined;
        if (path) {
          setError(path, { message: issue.message });
        }
      });
      return;
    }
    await onSubmit(result.data);
  }

  const inputCls =
    "h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

  return (
    <Dialog.Root open={open} onOpenChange={handleClose} modal>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-150" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-card shadow-xl",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            "transition-[opacity,transform] duration-150",
            "max-h-[90dvh] flex flex-col"
          )}
        >
          {/* Dialog header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <Dialog.Title className="text-base font-semibold">
              Record payment
            </Dialog.Title>
            <Dialog.Close
              render={
                <button
                  className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                  aria-label="Close"
                  type="button"
                >
                  <X className="size-4" />
                </button>
              }
            />
          </div>

          {/* Form — scrollable body */}
          <form
            id={formId}
            onSubmit={handleSubmit(onValid)}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          >
            {/* Submit error */}
            {submitError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            )}

            {/* Invoice selector */}
            <FormField
              label="Invoice"
              required
              error={errors.invoiceId?.message}
            >
              <select
                {...register("invoiceId")}
                className={cn(inputCls, "h-8 cursor-pointer")}
                aria-invalid={!!errors.invoiceId}
              >
                <option value="">Select invoice…</option>
                {invoices.filter(
                  (invoice) => ["sent", "partial", "overdue"].includes(invoice.status)
                ).map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} — {inv.customer_id} (
                    {formatMinorUnits(decimalToMinorUnits(inv.amount_due), inv.currency)}{" "}
                    due)
                  </option>
                ))}
              </select>
            </FormField>

            {/* Amount as decimal string */}
            <FormField
              label="Amount"
              required
              error={errors.amount?.message}
              description="Enter the amount in rupees, e.g. 159.30"
            >
              <input
                type="text"
                inputMode="decimal"
                {...register("amount")}
                placeholder="e.g. 159.30"
                className={inputCls}
                aria-invalid={!!errors.amount}
              />
            </FormField>

            {/* Method */}
            <FormField
              label="Payment method"
              required
              error={errors.method?.message}
            >
              <select
                {...register("method")}
                className={cn(inputCls, "h-8 cursor-pointer")}
                aria-invalid={!!errors.method}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Status */}
            <FormField
              label="Initial status"
              required
              error={errors.status?.message}
            >
              <select
                {...register("status")}
                className={cn(inputCls, "h-8 cursor-pointer")}
                aria-invalid={!!errors.status}
              >
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </FormField>

            {/* Date */}
            <FormField
              label="Payment date"
              required
              error={errors.date?.message}
            >
              <input
                type="date"
                {...register("date")}
                className={inputCls}
                aria-invalid={!!errors.date}
              />
            </FormField>

            {/* Payment reference (optional) */}
            <FormField
              label="Payment reference"
              error={errors.reference?.message}
              description="Optional — transaction ID, cheque number, UTR, etc."
            >
              <input
                type="text"
                {...register("reference")}
                placeholder="e.g. UTR123456"
                className={inputCls}
                aria-invalid={!!errors.reference}
              />
            </FormField>

            {/* Notes */}
            <FormField
              label="Notes"
              error={errors.notes?.message}
              description="Internal note, not visible to the customer"
            >
              <textarea
                {...register("notes")}
                rows={3}
                placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 resize-none aria-[invalid=true]:border-destructive"
                aria-invalid={!!errors.notes}
              />
            </FormField>
          </form>

          {/* Footer */}
          <div className="border-t border-border px-5 py-4 flex justify-end gap-2 shrink-0">
            <Button variant="outline" type="button" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={isSubmitting}>
              {isSubmitting ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PaymentDrawerProps {
  payment: PaymentRow | null;
  detail: ApiPayment | null;
  error: string | null;
  refundAmount: string;
  refundReason: string;
  onRefundAmountChange: (value: string) => void;
  onRefundReasonChange: (value: string) => void;
  onClose: () => void;
  onAction: (action: "confirm" | "fail" | "refund" | "recalculate") => Promise<void>;
}

function PaymentDrawer({
  payment,
  detail,
  error,
  refundAmount,
  refundReason,
  onRefundAmountChange,
  onRefundReasonChange,
  onClose,
  onAction,
}: PaymentDrawerProps) {
  const [refundFormOpen, setRefundFormOpen] = useState(false);
  if (!payment) return null;

  return (
    <Dialog.Root open modal onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold">{payment.reference}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">{payment.invoiceNumber} · {payment.customerName}</Dialog.Description>
            </div>
            <Dialog.Close render={<button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="size-4" /></button>} />
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <StatusBadge status={payment.status} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <DetailRow label="Amount" value={formatMinorUnits(decimalToMinorUnits(payment.amount), payment.currency)} />
              <DetailRow label="Method" value={formatLabel(payment.method)} />
              <DetailRow label="Date" value={formatDate(payment.date)} />
              <DetailRow label="Refunded" value={formatMinorUnits(decimalToMinorUnits(detail?.refunded_amount ?? payment.refundedAmount), payment.currency)} />
              <DetailRow label="Invoice" value={payment.invoiceNumber} />
            </dl>
            {detail ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">Payment details</p>
                <p className="text-muted-foreground">Payment ID: <span className="font-mono">{detail.id}</span></p>
                {detail.notes && <p className="whitespace-pre-wrap">{detail.notes}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">Loading payment details…</p>}
            {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            {refundFormOpen && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">Refund (admin only)</p>
                <label className="block space-y-1 text-sm"><span>Amount (leave blank for full refund)</span><input inputMode="decimal" pattern="\\d+(\\.\\d{1,2})?" value={refundAmount} onChange={(event) => onRefundAmountChange(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-3" /></label>
                <label className="block space-y-1 text-sm"><span>Reason</span><textarea maxLength={1000} value={refundReason} onChange={(event) => onRefundReasonChange(event.target.value)} className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
                <Button size="sm" variant="destructive" onClick={() => onAction("refund")}>Submit refund</Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
            {payment.status === "pending" && <>
              <Button size="sm" variant="outline" onClick={() => onAction("confirm")}><ConfirmIcon className="size-3.5" /> Confirm</Button>
              <Button size="sm" variant="destructive" onClick={() => onAction("fail")}><XCircle className="size-3.5" /> Mark failed</Button>
            </>}
            {(payment.status === "completed" || payment.status === "partially_refunded") && !refundFormOpen && (
              <Button size="sm" variant="outline" onClick={() => setRefundFormOpen(true)}><RotateCcw className="size-3.5" /> Refund</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onAction("recalculate")}>Recalculate invoice</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></>;
}

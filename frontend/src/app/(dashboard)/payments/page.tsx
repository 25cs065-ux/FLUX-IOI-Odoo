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
  WifiOff,
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
import {
  MOCK_PAYMENTS,
  type MockPayment,
  type PaymentMethod,
} from "@/mocks/payments";
import { MOCK_INVOICES } from "@/mocks/invoices";
import { formatCents, formatDate, formatLabel, formatDecimalInr } from "@/lib/format";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiPayment, ApiPaymentMethod, CreatePaymentBody } from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter — map backend payment to mock shape for table display
// ---------------------------------------------------------------------------

function adaptPayment(api: ApiPayment): MockPayment {
  const amountCents = Math.round(parseFloat(api.amount) * 100);
  return {
    id: api.id,
    reference: api.payment_reference ?? api.id.slice(0, 8).toUpperCase(),
    invoiceId: api.invoice_id,
    invoiceNumber: api.invoice_number,
    customerId: api.customer_id,
    customerName: api.customer_name,
    status: api.status as MockPayment["status"],
    method: api.method as PaymentMethod,
    date: api.payment_date,
    amountCents,
    currency: api.currency,
    maskedAccount: null,
    gatewayReference: null,
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
  status: z.enum(["pending", "completed", "failed"] as const, {
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

type PayStatus = MockPayment["status"];

const STATUS_FILTER_OPTIONS: { label: string; value: PayStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
  { label: "Refunded", value: "refunded" },
];

const PAYMENT_METHODS: { label: string; value: PaymentMethod }[] = [
  { label: "Bank transfer", value: "bank_transfer" },
  { label: "Credit card", value: "credit_card" },
  { label: "UPI", value: "upi" },
  { label: "Cash", value: "cash" },
  { label: "Cheque", value: "cheque" },
  { label: "Other", value: "other" },
];

const METHOD_LABEL: Record<PaymentMethod, string> = {
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

function buildColumns(): ColumnDef<MockPayment>[] {
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
      key: "amountCents",
      header: "Amount",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {formatDecimalInr(String(row.amountCents / 100))}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      cell: (row) => METHOD_LABEL[row.method as PaymentMethod] ?? formatLabel(row.method),
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
  ];
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PaymentsPage() {
  const [payments, setPayments] = useState<MockPayment[]>(MOCK_PAYMENTS);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  const [statusFilter, setStatusFilter] = useState<PayStatus | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Fetch from API ───────────────────────────────────────────────────────
  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const token = getSupabaseToken();
      const qs = buildQuery({ status: statusFilter === "all" ? undefined : statusFilter, limit: 100 });
      const { data } = await apiClient.get<ApiPayment[]>(
        `/payments${qs}`,
        token ? { token } : undefined
      );
      if (data && Array.isArray(data)) {
        setPayments(data.map(adaptPayment));
        setUsingMock(false);
      }
    } catch {
      setPayments(MOCK_PAYMENTS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredPayments = useMemo(
    () =>
      statusFilter === "all" || !usingMock
        ? payments
        : payments.filter((p) => p.status === statusFilter),
    [payments, statusFilter, usingMock]
  );

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const collected = payments
      .filter((p) => p.status === "completed")
      .reduce((acc, p) => acc + p.amountCents, 0);
    const pending = payments.filter((p) => p.status === "pending").length;
    const failed = payments.filter((p) => p.status === "failed").length;
    return { collected, pending, failed, total: payments.length };
  }, [payments]);

  // ── Add new payment ────────────────────────────────────────────────────────
  async function handleRecordPayment(data: RecordPaymentForm) {
    setSubmitError(null);

    if (!usingMock) {
      try {
        const token = getSupabaseToken();
        const body: CreatePaymentBody = {
          invoice_id: data.invoiceId,
          amount: data.amount,
          method: data.method as ApiPaymentMethod,
          status: data.status,
          payment_date: data.date,
          payment_reference: data.reference,
          notes: data.notes,
        };
        await apiClient.post("/payments", body, token ? { token } : undefined);
        await fetchPayments();
        setDialogOpen(false);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to record payment";
        setSubmitError(msg);
        return;
      }
    }

    // Mock fallback — add to local state
    const invoice = MOCK_INVOICES.find((i) => i.id === data.invoiceId);
    const amountCents = Math.round(parseFloat(data.amount) * 100);
    const nextId = `pay_${String(payments.length + 1).padStart(3, "0")}_new`;
    const newPayment: MockPayment = {
      id: nextId,
      reference: data.reference ?? `PAY-${String(payments.length + 1).padStart(4, "0")}`,
      invoiceId: data.invoiceId,
      invoiceNumber: invoice?.invoiceNumber ?? data.invoiceId,
      customerId: invoice?.customerId ?? "cus_unknown",
      customerName: invoice?.customerName ?? "Unknown",
      status: data.status,
      method: data.method as PaymentMethod,
      date: data.date,
      amountCents,
      currency: "INR",
      maskedAccount: null,
      gatewayReference: null,
    };
    setPayments((prev) => [newPayment, ...prev]);
    setDialogOpen(false);
  }

  const columns = useMemo(() => buildColumns(), []);

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
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <WifiOff className="size-3" />
              Demo data
            </span>
          )}
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Total collected"
          value={formatDecimalInr(String(stats.collected / 100))}
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
        <DataTable<MockPayment>
          columns={columns}
          data={filteredPayments}
          rowKey="id"
          pageSize={8}
          searchPlaceholder="Search by customer, invoice, reference…"
          searchKeys={["customerName", "invoiceNumber", "reference", "status"]}
          emptyMessage={loading ? "Loading…" : "No payments match the current filter."}
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
      <RecordPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleRecordPayment}
        submitError={submitError}
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
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  onSubmit,
  submitError,
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
      date: "",
      method: "bank_transfer",
      status: "completed",
    },
  });

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  function onValid(raw: RecordPaymentForm) {
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
    onSubmit(result.data);
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
                {MOCK_INVOICES.filter(
                  (i) => i.status !== "paid" && i.status !== "cancelled"
                ).map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {inv.customerName} (
                    {formatCents(inv.totalCents - inv.paidCents, inv.currency)}{" "}
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
                <option value="failed">Failed</option>
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

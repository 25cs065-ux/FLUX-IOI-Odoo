"use client";

import { useState, useMemo, useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import {
  Wallet,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plus,
  X,
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
import { formatCents, formatDate, formatLabel } from "@/lib/format";

// ---------------------------------------------------------------------------
// Zod schema for Record Payment form
// ---------------------------------------------------------------------------

const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Please select an invoice"),
  amountCents: z
    .number({ error: "Amount is required" })
    .int("Must be a whole number of cents")
    .positive("Amount must be greater than 0"),
  method: z.enum(["card", "bank_transfer", "paypal", "crypto", "other"] as const, {
    error: "Please select a payment method",
  }),
  date: z.string().min(1, "Date is required"),
  maskedAccount: z.string().optional(),
  note: z.string().max(500, "Note must be 500 characters or less").optional(),
});

type RecordPaymentForm = z.infer<typeof recordPaymentSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type PayStatus = MockPayment["status"];

const STATUS_FILTER_OPTIONS: { label: string; value: PayStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Paid", value: "paid" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
];

const PAYMENT_METHODS: { label: string; value: PaymentMethod }[] = [
  { label: "Card", value: "card" },
  { label: "Bank transfer", value: "bank_transfer" },
  { label: "PayPal", value: "paypal" },
  { label: "Crypto", value: "crypto" },
  { label: "Other", value: "other" },
];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  paypal: "PayPal",
  crypto: "Crypto",
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
          {formatCents(row.amountCents, row.currency)}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      cell: (row) => METHOD_LABEL[row.method],
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
  const [statusFilter, setStatusFilter] = useState<PayStatus | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredPayments = useMemo(
    () =>
      statusFilter === "all"
        ? payments
        : payments.filter((p) => p.status === statusFilter),
    [payments, statusFilter]
  );

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const collected = payments
      .filter((p) => p.status === "paid")
      .reduce((acc, p) => acc + p.amountCents, 0);
    const pending = payments.filter((p) => p.status === "pending").length;
    const failed = payments.filter((p) => p.status === "failed").length;
    return { collected, pending, failed, total: payments.length };
  }, [payments]);

  // ── Add new payment (local mock state only) ───────────────────────────────
  function handleRecordPayment(data: RecordPaymentForm) {
    const invoice = MOCK_INVOICES.find((i) => i.id === data.invoiceId);
    const nextId = `pay_${String(payments.length + 1).padStart(3, "0")}_new`;
    const newPayment: MockPayment = {
      id: nextId,
      reference: `PAY-2026-${String(payments.length + 1).padStart(4, "0")}`,
      invoiceId: data.invoiceId,
      invoiceNumber: invoice?.invoiceNumber ?? data.invoiceId,
      customerId: invoice?.customerId ?? "cus_unknown",
      customerName: invoice?.customerName ?? "Unknown",
      status: "pending",
      method: data.method,
      date: data.date,
      amountCents: data.amountCents,
      currency: "USD",
      maskedAccount: data.maskedAccount ?? null,
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
          <span className="hidden sm:inline rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            Demo data — actions are local only
          </span>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" />
            Record payment
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Total collected"
          value={formatCents(stats.collected, "USD")}
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
          emptyMessage="No payments match the current filter."
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
  onSubmit: (data: RecordPaymentForm) => void;
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  onSubmit,
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
      // Avoid new Date() at module-level prerender; set an empty string and
      // let the date input default to its own empty state. The user picks the
      // date explicitly.
      date: "",
      method: "card",
    },
  });

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  function onValid(raw: RecordPaymentForm) {
    // Validate with Zod manually (no @hookform/resolvers dependency needed)
    const result = recordPaymentSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues;
      issues.forEach((issue) => {
        const path = issue.path[0] as keyof RecordPaymentForm | undefined;
        if (path) {
          setError(path, { message: issue.message });
        }
      });
      return;
    }
    onSubmit(result.data);
    reset();
  }

  // Input class reused across all inputs in the form
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

            {/* Amount in cents */}
            <FormField
              label="Amount (in cents)"
              required
              error={errors.amountCents?.message}
              description="Enter the exact amount in cents, e.g. 4900 = $49.00"
            >
              <input
                type="number"
                min={1}
                step={1}
                {...register("amountCents", { valueAsNumber: true })}
                placeholder="e.g. 4900"
                className={inputCls}
                aria-invalid={!!errors.amountCents}
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

            {/* Masked account (optional) */}
            <FormField
              label="Masked account / card last 4"
              error={errors.maskedAccount?.message}
              description="Optional — e.g. •••• 4242"
            >
              <input
                type="text"
                {...register("maskedAccount")}
                placeholder="•••• 4242"
                className={inputCls}
                aria-invalid={!!errors.maskedAccount}
              />
            </FormField>

            {/* Note */}
            <FormField
              label="Note"
              error={errors.note?.message}
              description="Internal note, not visible to the customer"
            >
              <textarea
                {...register("note")}
                rows={3}
                placeholder="Optional note…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 resize-none aria-[invalid=true]:border-destructive"
                aria-invalid={!!errors.note}
              />
            </FormField>

            {/* Demo notice */}
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              ⚠️ This form adds to local state only. No backend call is made.
            </p>
          </form>

          {/* Footer */}
          <div className="border-t border-border px-5 py-4 flex justify-end gap-2 shrink-0">
            <Button variant="outline" type="button" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={isSubmitting}>
              Record payment
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

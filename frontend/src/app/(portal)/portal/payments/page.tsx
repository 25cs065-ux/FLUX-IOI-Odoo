"use client";

import { useCallback, useEffect, useState } from "react";

import { DataTable, StatusBadge, type ColumnDef } from "@/components/shared";
import { formatDate, formatLabel } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits } from "@/lib/money";
import { apiClient, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiInvoiceSummary, ApiPayment, ApiPaymentMethod, PaymentStatus } from "@/types/api";

interface PortalPayment {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  status: PaymentStatus;
  method: ApiPaymentMethod;
  date: string;
  amount: string;
  refundedAmount: string;
  currency: string;
}

function adaptPayment(
  payment: ApiPayment,
  invoices: Map<string, ApiInvoiceSummary>
): PortalPayment {
  return {
    id: payment.id,
    reference: payment.payment_reference || payment.id.slice(0, 8).toUpperCase(),
    invoiceId: payment.invoice_id,
    invoiceNumber: invoices.get(payment.invoice_id)?.invoice_number ?? payment.invoice_id,
    status: payment.status,
    method: payment.method,
    date: payment.payment_date,
    amount: payment.amount,
    refundedAmount: payment.refunded_amount,
    currency: payment.currency,
  };
}

const COLUMNS: ColumnDef<PortalPayment>[] = [
  {
    key: "reference",
    header: "Reference",
    cell: (row) => (
      <span className="font-mono text-xs text-muted-foreground">{row.reference}</span>
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
    cell: (row) => formatLabel(row.method),
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

export default function PortalPaymentsPage() {
  const [myPayments, setMyPayments] = useState<PortalPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      const options = token ? { token } : undefined;
      const [payments, invoiceResponse] = await Promise.all([
        getAllPages<ApiPayment>("/payments", 200, options),
        getAllPages<ApiInvoiceSummary>("/invoices", 200, options),
      ]);
      const invoices = new Map(invoiceResponse.map((invoice) => [invoice.id, invoice]));
      setMyPayments(payments.map((payment) => adaptPayment(payment, invoices)));
      setError(null);
    } catch (err) {
      setMyPayments([]);
      setError(err instanceof Error ? err.message : "Failed to load payment history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchPayments());
  }, [fetchPayments]);

  const netPaid = myPayments
    .filter((payment) => payment.status === "completed" || payment.status === "partially_refunded")
    .reduce(
      (total, payment) =>
        total +
        decimalToMinorUnits(payment.amount) -
        decimalToMinorUnits(payment.refundedAmount),
      0n
    );
  const totalCurrency = myPayments[0]?.currency ?? "INR";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Payment History</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          All payments made on your account
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button className="shrink-0 text-xs underline" onClick={() => void fetchPayments()}>
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          {myPayments.length} payment record{myPayments.length !== 1 ? "s" : ""}
        </span>
        <span className="font-semibold tabular-nums">
          Total paid:{" "}
          <span className="text-green-600 dark:text-green-400">
            {formatMinorUnits(netPaid, totalCurrency)}
          </span>
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<PortalPayment>
          columns={COLUMNS}
          data={myPayments}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search by reference, invoice, method…"
          searchKeys={["reference", "invoiceNumber", "status", "method"]}
          emptyMessage={loading ? "Loading…" : "No payment records found."}
        />
      </div>
    </div>
  );
}

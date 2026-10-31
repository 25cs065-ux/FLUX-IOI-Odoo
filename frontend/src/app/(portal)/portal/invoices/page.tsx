"use client";

import { useState, useEffect, useCallback } from "react";
import { Printer, X, DollarSign } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";

import { DataTable, StatusBadge, type ColumnDef } from "@/components/shared";
import { formatDate } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits } from "@/lib/money";
import { apiClient, clearApiCache, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiInvoice, ApiInvoiceSummary, InvoiceStatus } from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalAmount: string;
  amountPaid: string;
  amountDue: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
}

function adaptInvoice(api: ApiInvoiceSummary): PortalInvoice {
  return {
    id: api.id,
    invoiceNumber: api.invoice_number,
    status: api.status,
    totalAmount: api.total_amount,
    amountPaid: api.amount_paid,
    amountDue: api.amount_due,
    currency: api.currency,
    issueDate: api.issue_date,
    dueDate: api.due_date,
    paidAt: api.paid_at,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortalInvoicesPage() {
  const [myInvoices, setMyInvoices] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<PortalInvoice | null>(null);

  const fetchInvoices = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      const data = await getAllPages<ApiInvoiceSummary>(
        "/invoices",
        200,
        token ? { token } : undefined
      );
      setMyInvoices(data.map(adaptInvoice));
      setError(null);
    } catch (err) {
      setMyInvoices([]);
      setError(err instanceof Error ? err.message : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchInvoices());
  }, [fetchInvoices]);

  async function viewInvoice(invoice: PortalInvoice) {
    setSelectedInvoice(invoice);
    try {
      const token = await getSupabaseToken();
      const { data } = await apiClient.get<ApiInvoice>(
        `/invoices/${invoice.id}`,
        token ? { token } : undefined
      );
      if (!data) throw new Error("The invoice details endpoint returned no data.");
      setSelectedInvoice(adaptInvoice(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice details.");
    }
  }

  const columns = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row: PortalInvoice) => (
        <span className="font-mono text-xs font-medium">{row.invoiceNumber}</span>
      ),
    },
    {
      key: "issueDate",
      header: "Issued",
      cell: (row: PortalInvoice) => formatDate(row.issueDate),
      hideOnMobile: true,
    },
    {
      key: "dueDate",
      header: "Due",
      cell: (row: PortalInvoice) => (
        <span className={cn(row.status === "overdue" ? "text-orange-600 dark:text-orange-400 font-medium" : "")}>
          {formatDate(row.dueDate)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "totalAmount",
      header: "Amount",
      cell: (row: PortalInvoice) => (
        <span className="tabular-nums font-medium">
          {formatMinorUnits(decimalToMinorUnits(row.totalAmount), row.currency)}
        </span>
      ),
    },
    {
      key: "amountDue",
      header: "Balance due",
      cell: (row: PortalInvoice) => {
        const balance = decimalToMinorUnits(row.amountDue);
        return (
          <span className={cn("tabular-nums", balance > 0 ? "text-destructive font-medium" : "text-green-600 dark:text-green-400")}>
            {formatMinorUnits(balance, row.currency)}
          </span>
        );
      },
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      cell: (row: PortalInvoice) => <StatusBadge status={row.status} />,
    },
    {
      key: "_view",
      header: "",
      cell: (row: PortalInvoice) => (
        <button onClick={() => void viewInvoice(row)} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
          View
        </button>
      ),
    },
  ] satisfies ColumnDef<PortalInvoice>[];

  const outstanding = myInvoices
    .filter((i) => i.status === "sent" || i.status === "overdue" || i.status === "partial")
    .reduce((acc, i) => acc + decimalToMinorUnits(i.amountDue), 0n);
  const currency = myInvoices[0]?.currency ?? "INR";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Invoices</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            View and download your invoices
          </p>
        </div>
      </div>

      {/* Outstanding notice */}
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button className="shrink-0 text-xs underline" onClick={() => { clearApiCache(); void fetchInvoices(); }}>
            Retry
          </button>
        </div>
      )}
      {outstanding > 0n && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30 px-4 py-3 text-sm">
          <DollarSign className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>
            You have{" "}
            <strong>{formatMinorUnits(outstanding, currency)}</strong> in
            outstanding invoices.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<PortalInvoice>
          columns={columns}
          data={myInvoices}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search by invoice number or status…"
          searchKeys={["invoiceNumber", "status"]}
          emptyMessage={loading ? "Loading…" : "You have no invoices yet."}
        />
      </div>

      {/* Detail drawer */}
      <InvoiceDetailDrawer
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail drawer
// ---------------------------------------------------------------------------

interface DrawerProps {
  invoice: PortalInvoice | null;
  onClose: () => void;
}

function InvoiceDetailDrawer({ invoice, onClose }: DrawerProps) {
  if (!invoice) return null;

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
                Issued {formatDate(invoice.issueDate)}
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
            <StatusBadge status={invoice.status} />

            {/* Amount summary */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice total</span>
                <span className="font-semibold tabular-nums">
                  {formatMinorUnits(decimalToMinorUnits(invoice.totalAmount), invoice.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular-nums text-green-600 dark:text-green-400">
                  {formatMinorUnits(decimalToMinorUnits(invoice.amountPaid), invoice.currency)}
                </span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span>Balance due</span>
                <span
                  className={cn(
                    "tabular-nums",
                    balanceDue > 0
                      ? "text-destructive"
                      : "text-green-600 dark:text-green-400"
                  )}
                >
                  {formatMinorUnits(balanceDue, invoice.currency)}
                </span>
              </div>
            </div>

            {/* Details */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Issue date</dt>
              <dd>{formatDate(invoice.issueDate)}</dd>
              <dt className="text-muted-foreground">Due date</dt>
              <dd
                className={cn(
                  invoice.status === "overdue"
                    ? "font-medium text-orange-600 dark:text-orange-400"
                    : ""
                )}
              >
                {formatDate(invoice.dueDate)}
              </dd>
              {invoice.paidAt && (
                <>
                  <dt className="text-muted-foreground">Paid on</dt>
                  <dd className="text-green-600 dark:text-green-400">
                    {formatDate(invoice.paidAt)}
                  </dd>
                </>
              )}
            </dl>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-5 py-4">
            <button
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium border border-border hover:bg-muted transition-colors w-full justify-center"
              onClick={() => window.print()}
            >
              <Printer className="size-4" />
              Print / Download PDF
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Use your browser&apos;s print dialog to save a PDF.
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

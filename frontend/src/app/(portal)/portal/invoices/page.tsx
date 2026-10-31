"use client";

import { useState, useEffect } from "react";
import { Printer, X, DollarSign, WifiOff } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";

import { DataTable, StatusBadge, type ColumnDef } from "@/components/shared";
import { DEMO_CUSTOMER } from "@/mocks/demo-customer";
import { MOCK_INVOICES, type MockInvoice } from "@/mocks/invoices";
import { formatInrCentsFull, formatDate } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiInvoice } from "@/types/api";

// ---------------------------------------------------------------------------
// Adapter
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
          {formatInrCentsFull(row.totalCents)}
        </span>
      ),
    },
    {
      key: "paidCents",
      header: "Balance due",
      cell: (row) => {
        const balance = row.totalCents - row.paidCents;
        return (
          <span
            className={cn(
              "tabular-nums",
              balance > 0 ? "text-destructive font-medium" : "text-green-600 dark:text-green-400"
            )}
          >
            {formatInrCentsFull(balance)}
          </span>
        );
      },
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "_view",
      header: "",
      cell: (row) => (
        <button
          onClick={() => onView(row)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          View
        </button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortalInvoicesPage() {
  const [myInvoices, setMyInvoices] = useState<MockInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = getSupabaseToken();
        const { data } = await apiClient.get<ApiInvoice[]>(
          "/invoices?limit=100",
          token ? { token } : undefined
        );
        if (data && Array.isArray(data)) {
          setMyInvoices(data.map(adaptInvoice));
          setUsingMock(false);
        }
      } catch {
        setMyInvoices(MOCK_INVOICES.filter((i) => i.customerId === DEMO_CUSTOMER.id));
        setUsingMock(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const columns = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row: MockInvoice) => (
        <span className="font-mono text-xs font-medium">{row.invoiceNumber}</span>
      ),
    },
    {
      key: "issuedDate",
      header: "Issued",
      cell: (row: MockInvoice) => formatDate(row.issuedDate),
      hideOnMobile: true,
    },
    {
      key: "dueDate",
      header: "Due",
      cell: (row: MockInvoice) => (
        <span className={cn(row.status === "overdue" ? "text-orange-600 dark:text-orange-400 font-medium" : "")}>
          {formatDate(row.dueDate)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "totalCents",
      header: "Amount",
      cell: (row: MockInvoice) => (
        <span className="tabular-nums font-medium">{formatInrCentsFull(row.totalCents)}</span>
      ),
    },
    {
      key: "paidCents",
      header: "Balance due",
      cell: (row: MockInvoice) => {
        const balance = row.totalCents - row.paidCents;
        return (
          <span className={cn("tabular-nums", balance > 0 ? "text-destructive font-medium" : "text-green-600 dark:text-green-400")}>
            {formatInrCentsFull(balance)}
          </span>
        );
      },
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      cell: (row: MockInvoice) => <StatusBadge status={row.status} />,
    },
    {
      key: "_view",
      header: "",
      cell: (row: MockInvoice) => (
        <button onClick={() => setSelectedInvoice(row)} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
          View
        </button>
      ),
    },
  ] satisfies ColumnDef<MockInvoice>[];

  const outstandingCents = myInvoices
    .filter((i) => i.status === "sent" || i.status === "overdue" || i.status === "partial")
    .reduce((acc, i) => acc + (i.totalCents - i.paidCents), 0);

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
        {usingMock && (
          <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <WifiOff className="size-3" />
            Demo data
          </span>
        )}
      </div>

      {/* Outstanding notice */}
      {outstandingCents > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30 px-4 py-3 text-sm">
          <DollarSign className="size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>
            You have{" "}
            <strong>{formatInrCentsFull(outstandingCents)}</strong> in
            outstanding invoices.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<MockInvoice>
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
  invoice: MockInvoice | null;
  onClose: () => void;
}

function InvoiceDetailDrawer({ invoice, onClose }: DrawerProps) {
  if (!invoice) return null;

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
                Issued {formatDate(invoice.issuedDate)}
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
                  {formatInrCentsFull(invoice.totalCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular-nums text-green-600 dark:text-green-400">
                  {formatInrCentsFull(invoice.paidCents)}
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
                  {formatInrCentsFull(balanceDue)}
                </span>
              </div>
            </div>

            {/* Details */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Issue date</dt>
              <dd>{formatDate(invoice.issuedDate)}</dd>
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
              {invoice.paidDate && (
                <>
                  <dt className="text-muted-foreground">Paid on</dt>
                  <dd className="text-green-600 dark:text-green-400">
                    {formatDate(invoice.paidDate)}
                  </dd>
                </>
              )}
            </dl>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-5 py-4">
            <button
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium border border-border hover:bg-muted transition-colors w-full justify-center"
              onClick={() => alert("PDF download is not available in demo mode.")}
            >
              <Printer className="size-4" />
              Print / Download PDF
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Download not available in demo mode.
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

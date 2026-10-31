"use client";

import { DataTable, StatusBadge, type ColumnDef } from "@/components/shared";
import { DEMO_CUSTOMER } from "@/mocks/demo-customer";
import { MOCK_PAYMENTS, type MockPayment } from "@/mocks/payments";
import { formatInrCentsFull, formatDate, formatLabel } from "@/lib/format";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<MockPayment>[] = [
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
    key: "amountCents",
    header: "Amount",
    cell: (row) => (
      <span className="tabular-nums font-medium">
        {formatInrCentsFull(row.amountCents)}
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
  {
    key: "maskedAccount",
    header: "Account",
    cell: (row) =>
      row.maskedAccount ? (
        <span className="font-mono text-xs">{row.maskedAccount}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
];

// ---------------------------------------------------------------------------
// Page — server component (no interactivity required)
// ---------------------------------------------------------------------------

export default function PortalPaymentsPage() {
  const myPayments = MOCK_PAYMENTS.filter(
    (p) => p.customerId === DEMO_CUSTOMER.id
  );

  const totalPaidCents = myPayments
    .filter((p) => p.status === "paid")
    .reduce((acc, p) => acc + p.amountCents, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Payment History
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            All payments made on your account
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm flex items-center justify-between gap-4 flex-wrap">
        <span className="text-muted-foreground">
          {myPayments.length} payment record{myPayments.length !== 1 ? "s" : ""}
        </span>
        <span className="font-semibold tabular-nums">
          Total paid:{" "}
          <span className="text-green-600 dark:text-green-400">
            {formatInrCentsFull(totalPaidCents)}
          </span>
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable<MockPayment>
          columns={COLUMNS}
          data={myPayments}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search by reference, invoice, method…"
          searchKeys={["reference", "invoiceNumber", "status", "method"]}
          emptyMessage="No payment records found."
        />
      </div>
    </div>
  );
}

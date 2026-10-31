"use client";

import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";

import { DataTable, StatusBadge, type ColumnDef } from "@/components/shared";
import { DEMO_CUSTOMER } from "@/mocks/demo-customer";
import { MOCK_PAYMENTS, type MockPayment } from "@/mocks/payments";
import { formatInrCentsFull, formatDate, formatLabel } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type { ApiPayment } from "@/types/api";
import type { PaymentMethod } from "@/mocks/payments";

// ---------------------------------------------------------------------------
// Adapter
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
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortalPaymentsPage() {
  const [myPayments, setMyPayments] = useState<MockPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const token = await getSupabaseToken();
        const { data } = await apiClient.get<ApiPayment[]>(
          "/payments?limit=100",
          token ? { token } : undefined
        );
        if (data && Array.isArray(data)) {
          setMyPayments(data.map(adaptPayment));
          setUsingMock(false);
        }
      } catch {
        setMyPayments(MOCK_PAYMENTS.filter((p) => p.customerId === DEMO_CUSTOMER.id));
        setUsingMock(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const totalPaidCents = myPayments
    .filter((p) => p.status === "completed")
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
        {usingMock && (
          <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <WifiOff className="size-3" />
            Demo data
          </span>
        )}
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
          emptyMessage={loading ? "Loading…" : "No payment records found."}
        />
      </div>
    </div>
  );
}

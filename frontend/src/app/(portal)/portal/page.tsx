import Link from "next/link";
import {
  CreditCard,
  FileText,
  Wallet,
  CalendarDays,
  ArrowRight,
} from "lucide-react";

import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DEMO_CUSTOMER } from "@/mocks/demo-customer";
import { MOCK_SUBSCRIPTIONS } from "@/mocks/subscriptions";
import { MOCK_INVOICES } from "@/mocks/invoices";
import { MOCK_PAYMENTS } from "@/mocks/payments";
import { formatInrCents, formatInrCentsFull, formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Data filtered to the demo customer
// ---------------------------------------------------------------------------

const CID = DEMO_CUSTOMER.id;

const mySubscriptions = MOCK_SUBSCRIPTIONS.filter(
  (s) => s.customerId === CID
);
const myInvoices = MOCK_INVOICES.filter((i) => i.customerId === CID);
const myPayments = MOCK_PAYMENTS.filter((p) => p.customerId === CID);

// ---------------------------------------------------------------------------
// KPI derivations (integer cents throughout)
// ---------------------------------------------------------------------------

const activeSubCount = mySubscriptions.filter(
  (s) => s.status === "active"
).length;

const upcomingRenewals = mySubscriptions.filter(
  (s) => s.status === "active" && s.nextBillingDate !== null
).sort((a, b) =>
  (a.nextBillingDate ?? "").localeCompare(b.nextBillingDate ?? "")
);

const outstandingCents = myInvoices
  .filter((i) => i.status === "sent" || i.status === "partial" || i.status === "overdue")
  .reduce((acc, i) => acc + (i.totalCents - i.paidCents), 0);

const totalPaidCents = myPayments
  .filter((p) => p.status === "completed")
  .reduce((acc, p) => acc + p.amountCents, 0);

// Recent activity: last 3 invoices and last 3 payments
const recentInvoices = [...myInvoices]
  .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate))
  .slice(0, 3);

const recentPayments = [...myPayments]
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 3);

// ---------------------------------------------------------------------------
// Page — server component (no interactivity needed)
// ---------------------------------------------------------------------------

export default function PortalOverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* Welcome */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Welcome back, {DEMO_CUSTOMER.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {DEMO_CUSTOMER.company} · Customer since{" "}
          {formatDate(DEMO_CUSTOMER.createdAt)}
        </p>
        <span className="mt-1 self-start rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Demo session — no real authentication
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Active Subscriptions"
          value={activeSubCount}
          icon={CreditCard}
          description={`${mySubscriptions.length} total`}
        />
        <StatCard
          title="Next Renewal"
          value={
            upcomingRenewals[0]?.nextBillingDate
              ? formatDate(upcomingRenewals[0].nextBillingDate)
              : "—"
          }
          icon={CalendarDays}
          description={
            upcomingRenewals[0]
              ? upcomingRenewals[0].planName
              : "No upcoming renewals"
          }
        />
        <StatCard
          title="Outstanding"
          value={formatInrCents(outstandingCents)}
          icon={FileText}
          description="Unpaid invoices"
          trend={
            outstandingCents > 0
              ? { direction: "down", label: "action required" }
              : { direction: "neutral", label: "all clear" }
          }
        />
        <StatCard
          title="Total Paid"
          value={formatInrCents(totalPaidCents)}
          icon={Wallet}
          description="All-time payments"
          trend={{ direction: "up", label: "lifetime total" }}
        />
      </div>

      {/* Recent activity — two columns on wider screens */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent invoices */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Invoices
            </h2>
            <Link
              href="/portal/invoices"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>

          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No invoices yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentInvoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium truncate">
                      {inv.invoiceNumber}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Due {formatDate(inv.dueDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums font-medium">
                      {formatInrCentsFull(inv.totalCents)}
                    </span>
                    <StatusBadge status={inv.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent payments */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Payments
            </h2>
            <Link
              href="/portal/payments"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>

          {recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No payment records yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentPayments.map((pay) => (
                <li
                  key={pay.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium truncate">
                      {pay.reference}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(pay.date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums font-medium">
                      {formatInrCentsFull(pay.amountCents)}
                    </span>
                    <StatusBadge status={pay.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Upcoming renewals */}
      {upcomingRenewals.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Upcoming Renewals
          </h2>
          <ul className="space-y-2">
            {upcomingRenewals.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{sub.planName} Plan</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {sub.reference}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-right">
                  <span className="tabular-nums">
                    {formatInrCentsFull(sub.amountCents)}
                    <span className="text-xs text-muted-foreground ml-1">
                      /{sub.billingInterval.slice(0, 2)}
                    </span>
                  </span>
                  <div className="text-xs text-muted-foreground">
                    <CalendarDays className="size-3 inline mr-1" aria-hidden="true" />
                    {formatDate(sub.nextBillingDate)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

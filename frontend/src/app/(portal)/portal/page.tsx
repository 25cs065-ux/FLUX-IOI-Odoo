"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatDate } from "@/lib/format";
import { decimalToMinorUnits, formatMinorUnits as formatExactMoney } from "@/lib/money";
import { apiClient, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import type {
  ApiCustomer,
  ApiInvoiceSummary,
  ApiPayment,
  ApiPlan,
  ApiSubscriptionSummary,
} from "@/types/api";

export default function PortalOverviewPage() {
  const [customer, setCustomer] = useState<ApiCustomer | null>(null);
  const [subscriptions, setSubscriptions] = useState<ApiSubscriptionSummary[]>([]);
  const [invoices, setInvoices] = useState<ApiInvoiceSummary[]>([]);
  const [payments, setPayments] = useState<ApiPayment[]>([]);
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      const options = token ? { token } : undefined;
      const [customerData, subscriptionData, invoiceData, paymentData, planResponse] =
        await Promise.all([
          getAllPages<ApiCustomer>("/customers/", 100, options),
          getAllPages<ApiSubscriptionSummary>("/subscriptions", 200, options),
          getAllPages<ApiInvoiceSummary>("/invoices", 200, options),
          getAllPages<ApiPayment>("/payments", 200, options),
          apiClient.get<ApiPlan[]>("/plans/", options),
        ]);
      if (!planResponse.data) throw new Error("The plans endpoint returned no data.");
      setCustomer(customerData[0] ?? null);
      setSubscriptions(subscriptionData);
      setInvoices(invoiceData);
      setPayments(paymentData);
      setPlans(planResponse.data);
      setError(null);
    } catch (err) {
      setCustomer(null);
      setSubscriptions([]);
      setInvoices([]);
      setPayments([]);
      setPlans([]);
      setError(err instanceof Error ? err.message : "Failed to load your account overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchOverview());
  }, [fetchOverview]);

  const planNames = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.name])),
    [plans]
  );
  const activeSubCount = subscriptions.filter((sub) => sub.status === "active").length;
  const upcomingRenewals = subscriptions
    .filter((sub) => sub.status === "active" && sub.next_billing_date !== null)
    .sort((a, b) => (a.next_billing_date ?? "").localeCompare(b.next_billing_date ?? ""));
  const outstanding = invoices
    .filter((invoice) => ["sent", "partial", "overdue"].includes(invoice.status))
    .reduce((total, invoice) => total + decimalToMinorUnits(invoice.amount_due), 0n);
  const totalPaid = payments
    .filter((payment) => payment.status === "completed" || payment.status === "partially_refunded")
    .reduce(
      (total, payment) =>
        total +
        decimalToMinorUnits(payment.amount) -
        decimalToMinorUnits(payment.refunded_amount),
      0n
    );
  const recentInvoices = [...invoices]
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    .slice(0, 3);
  const recentPayments = [...payments]
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .slice(0, 3);
  const currency = invoices[0]?.currency ?? payments[0]?.currency ?? "INR";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Welcome back{customer?.name ? `, ${customer.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {customer?.email ?? "Your account overview"}
          {customer?.created_at && <> · Customer since {formatDate(customer.created_at)}</>}
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button className="shrink-0 text-xs underline" onClick={() => void fetchOverview()}>
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          title="Active Subscriptions"
          value={loading ? "—" : activeSubCount}
          icon={CreditCard}
          description={`${subscriptions.length} total`}
        />
        <StatCard
          title="Next Renewal"
          value={
            upcomingRenewals[0]?.next_billing_date
              ? formatDate(upcomingRenewals[0].next_billing_date)
              : "—"
          }
          icon={CalendarDays}
          description={
            upcomingRenewals[0]
              ? planNames.get(upcomingRenewals[0].plan_id) ?? upcomingRenewals[0].plan_id
              : "No upcoming renewals"
          }
        />
        <StatCard
          title="Outstanding"
          value={formatExactMoney(outstanding, currency)}
          icon={FileText}
          description="Unpaid invoices"
          trend={
            outstanding > 0n
              ? { direction: "down", label: "action required" }
              : { direction: "neutral", label: "all clear" }
          }
        />
        <StatCard
          title="Total Paid"
          value={formatExactMoney(totalPaid, currency)}
          icon={Wallet}
          description="All-time payments"
          trend={{ direction: "up", label: "lifetime total" }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Invoices</h2>
            <Link
              href="/portal/invoices"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading invoices…</p>
          ) : recentInvoices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentInvoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-medium">{invoice.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">Due {formatDate(invoice.due_date)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums font-medium">
                      {formatExactMoney(decimalToMinorUnits(invoice.total_amount), invoice.currency)}
                    </span>
                    <StatusBadge status={invoice.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Payments</h2>
            <Link
              href="/portal/payments"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading payments…</p>
          ) : recentPayments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No payment records yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentPayments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-medium">
                      {payment.payment_reference || payment.id.slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(payment.payment_date)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums font-medium">
                      {formatExactMoney(decimalToMinorUnits(payment.amount), payment.currency)}
                    </span>
                    <StatusBadge status={payment.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {upcomingRenewals.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Upcoming Renewals</h2>
          <ul className="space-y-2">
            {upcomingRenewals.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {planNames.get(sub.plan_id) ?? sub.plan_id} Plan
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{sub.subscription_number}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-right">
                  <span className="tabular-nums">
                    {formatExactMoney(decimalToMinorUnits(sub.total_amount), sub.currency)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      /{plans.find((plan) => plan.id === sub.plan_id)?.interval ?? "period"}
                    </span>
                  </span>
                  <div className="text-xs text-muted-foreground">
                    <CalendarDays className="mr-1 inline size-3" aria-hidden="true" />
                    {formatDate(sub.next_billing_date)}
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

"""In-memory stand-in for InvoiceRepository used by the invoice tests."""
import copy
from datetime import datetime, timezone
from decimal import Decimal

from app.repositories.invoice_repository import DEAD_INVOICE_STATUSES, DuplicateInvoiceError
from app.repositories.subscription_repository import to_row
from subscription_fakes import FakeSubscriptionRepository, new_id


class FakeInvoiceRepository(FakeSubscriptionRepository):
    def __init__(self):
        super().__init__()
        self.invoices, self.invoice_lines = {}, {}
        self._inv_seq = 1000
        self.fail_invoice_line_insert = False

    @staticmethod
    def _with_amount_due(row):
        # amount_due is a generated column in Postgres
        row["amount_due"] = str(Decimal(str(row["total_amount"])) - Decimal(str(row["amount_paid"])))
        return row

    def list_invoices(self, *, status, customer_id, subscription_id, exclude_statuses, limit, offset):
        rows = [i for i in self.invoices.values()
                if (not status or i["status"] == status)
                and (not customer_id or i["customer_id"] == str(customer_id))
                and (not subscription_id or i["subscription_id"] == str(subscription_id))
                and i["status"] not in exclude_statuses]
        rows.sort(key=lambda i: (i["issue_date"], i["invoice_number"]), reverse=True)
        return copy.deepcopy(rows[offset:offset + limit])

    def get_invoice(self, invoice_id):
        return self._get(self.invoices, invoice_id)

    def find_live_invoice(self, subscription_id, period_start, period_end):
        return next((copy.deepcopy(i) for i in self.invoices.values()
                     if i["subscription_id"] == str(subscription_id)
                     and i["billing_period_start"] == period_start.isoformat()
                     and i["billing_period_end"] == period_end.isoformat()
                     and i["status"] not in DEAD_INVOICE_STATUSES), None)

    def insert_invoice(self, data):
        self._record("invoices", "insert", data)
        row = {
            "id": new_id(), "invoice_number": f"INV-{self._inv_seq:06d}", "subscription_id": None,
            "payment_terms_id": None, "discount_id": None, "billing_period_start": None,
            "billing_period_end": None, "amount_paid": "0.00", "tax_name": None, "tax_rate": None,
            "notes": None, "terms_and_conditions": None, "sent_at": None, "paid_at": None,
            "voided_at": None, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": None,
            **to_row(data),
        }
        if row["subscription_id"] and row["billing_period_start"] and \
                self.find_live_invoice(row["subscription_id"], *(
                    datetime.fromisoformat(row[k]).date()
                    for k in ("billing_period_start", "billing_period_end"))):
            raise DuplicateInvoiceError("uix_invoice_live_period")
        self._inv_seq += 1
        self.invoices[row["id"]] = self._with_amount_due(row)
        return copy.deepcopy(row)

    def update_invoice(self, invoice_id, data, expected_status=None):
        self._record("invoices", "update", data)
        row = self.invoices.get(str(invoice_id))
        if not row or (expected_status and row["status"] != expected_status):
            return None
        row.update(to_row(data))
        return copy.deepcopy(self._with_amount_due(row))

    def delete_invoice(self, invoice_id):
        self.invoices.pop(str(invoice_id), None)
        self.delete_invoice_lines(invoice_id)

    def list_invoice_lines(self, invoice_id):
        rows = [l for l in self.invoice_lines.values() if l["invoice_id"] == str(invoice_id)]
        return copy.deepcopy(sorted(rows, key=lambda l: l["sequence"]))

    def insert_invoice_lines(self, lines):
        if self.fail_invoice_line_insert:
            raise RuntimeError("simulated database failure")
        out = []
        for line in lines:
            self._record("invoice_lines", "insert", line)
            row = {"id": new_id(), "created_at": None, "updated_at": None, **to_row(line)}
            self.invoice_lines[row["id"]] = row
            out.append(copy.deepcopy(row))
        return out

    def delete_invoice_lines(self, invoice_id):
        self.invoice_lines = {k: v for k, v in self.invoice_lines.items()
                              if v["invoice_id"] != str(invoice_id)}

    def list_billable_subscriptions(self, as_of):
        rows = [s for s in self.subscriptions.values()
                if s["status"] == "active" and s.get("next_billing_date")
                and s["next_billing_date"] <= as_of.isoformat()]
        return copy.deepcopy(sorted(rows, key=lambda s: s["next_billing_date"]))

    def list_overdue_candidates(self, as_of):
        return copy.deepcopy([i for i in self.invoices.values()
                              if i["status"] in ("sent", "partial") and i["due_date"] < as_of.isoformat()])

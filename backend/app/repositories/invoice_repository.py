"""Data access for invoices. Extends the subscription repository because
invoicing reads subscriptions/lines and advances next_billing_date."""
from datetime import date
from typing import Optional, Protocol
from uuid import UUID

from app.repositories.subscription_repository import (
    SubscriptionRepository,
    SupabaseSubscriptionRepository,
    to_row,
)

# Statuses excluded from the uix_invoice_live_period unique index.
DEAD_INVOICE_STATUSES = ("void", "cancelled")


class DuplicateInvoiceError(Exception):
    """A live invoice already exists for this subscription billing period."""


class InvoiceRepository(SubscriptionRepository, Protocol):
    def list_invoices(self, *, status: Optional[str], customer_id: Optional[UUID],
                      subscription_id: Optional[UUID], exclude_statuses: tuple,
                      limit: int, offset: int) -> list[dict]: ...
    def get_invoice(self, invoice_id: UUID) -> Optional[dict]: ...
    def find_live_invoice(self, subscription_id: UUID, period_start: date,
                          period_end: date) -> Optional[dict]: ...
    def insert_invoice(self, data: dict) -> dict:
        """Raises DuplicateInvoiceError on the live-period unique index."""
        ...
    def update_invoice(self, invoice_id: UUID, data: dict, expected_status: Optional[str] = None,
                       expected_amount_paid=None, expected_updated_at: Optional[str] = None) -> Optional[dict]:
        """Returns None if the row is missing or no longer matches the expected values."""
        ...
    def delete_invoice(self, invoice_id: UUID) -> None: ...
    def list_invoice_lines(self, invoice_id: UUID) -> list[dict]: ...
    def insert_invoice_lines(self, lines: list[dict]) -> list[dict]: ...
    def delete_invoice_lines(self, invoice_id: UUID) -> None: ...
    def delete_invoice_lines_by_ids(self, line_ids: list) -> None:
        """One DELETE statement, so it removes all of them or none."""
        ...
    def list_invoice_payments(self, invoice_id: UUID) -> list[dict]: ...
    def list_billable_subscriptions(self, as_of: date) -> list[dict]:
        """Active subscriptions with next_billing_date <= as_of."""
        ...
    def list_overdue_candidates(self, as_of: date) -> list[dict]:
        """Sent / partial invoices with due_date < as_of."""
        ...


class SupabaseInvoiceRepository(SupabaseSubscriptionRepository):
    def list_invoices(self, *, status, customer_id, subscription_id, exclude_statuses, limit, offset):
        query = self.db.table("invoices").select("*")
        if status:
            query = query.eq("status", status)
        if customer_id:
            query = query.eq("customer_id", str(customer_id))
        if subscription_id:
            query = query.eq("subscription_id", str(subscription_id))
        if exclude_statuses:
            query = query.not_.in_("status", list(exclude_statuses))
        res = query.order("issue_date", desc=True).range(offset, offset + limit - 1).execute()
        return res.data or []

    def get_invoice(self, invoice_id):
        return self._one("invoices", "id", invoice_id)

    def find_live_invoice(self, subscription_id, period_start, period_end):
        res = (self.db.table("invoices").select("*")
               .eq("subscription_id", str(subscription_id))
               .eq("billing_period_start", period_start.isoformat())
               .eq("billing_period_end", period_end.isoformat())
               .not_.in_("status", list(DEAD_INVOICE_STATUSES))
               .limit(1).execute())
        return res.data[0] if res.data else None

    def insert_invoice(self, data):
        from postgrest.exceptions import APIError

        try:
            return self.db.table("invoices").insert(to_row(data)).execute().data[0]
        except APIError as exc:
            if exc.code == "23505":     # unique_violation
                raise DuplicateInvoiceError(exc.message) from exc
            raise

    def update_invoice(self, invoice_id, data, expected_status=None, expected_amount_paid=None,
                       expected_updated_at=None):
        query = self.db.table("invoices").update(to_row(data)).eq("id", str(invoice_id))
        if expected_status:
            query = query.eq("status", expected_status)
        if expected_amount_paid is not None:
            # Guards balance updates against concurrent payments.
            query = query.eq("amount_paid", str(expected_amount_paid))
        if expected_updated_at:
            # Optimistic lock for edits: fails if anyone saved since we read.
            query = query.eq("updated_at", str(expected_updated_at))
        res = query.execute()
        return res.data[0] if res.data else None

    def delete_invoice(self, invoice_id):
        self.db.table("invoices").delete().eq("id", str(invoice_id)).execute()

    def list_invoice_lines(self, invoice_id):
        res = (self.db.table("invoice_lines").select("*")
               .eq("invoice_id", str(invoice_id)).order("sequence").execute())
        return res.data or []

    def insert_invoice_lines(self, lines):
        if not lines:
            return []
        return self.db.table("invoice_lines").insert([to_row(l) for l in lines]).execute().data

    def delete_invoice_lines(self, invoice_id):
        self.db.table("invoice_lines").delete().eq("invoice_id", str(invoice_id)).execute()

    def delete_invoice_lines_by_ids(self, line_ids):
        if line_ids:
            self.db.table("invoice_lines").delete().in_("id", [str(i) for i in line_ids]).execute()

    def list_invoice_payments(self, invoice_id):
        res = (self.db.table("payments").select("*").eq("invoice_id", str(invoice_id))
               .order("created_at").execute())
        return res.data or []

    def list_billable_subscriptions(self, as_of):
        res = (self.db.table("subscriptions").select("*").eq("status", "active")
               .lte("next_billing_date", as_of.isoformat()).order("next_billing_date").execute())
        return res.data or []

    def list_overdue_candidates(self, as_of):
        res = (self.db.table("invoices").select("*").in_("status", ["sent", "partial"])
               .lt("due_date", as_of.isoformat()).execute())
        return res.data or []


def get_invoice_repository() -> InvoiceRepository:
    """FastAPI dependency; tests override it with an in-memory fake."""
    from app.core.database import get_supabase

    return SupabaseInvoiceRepository(get_supabase())

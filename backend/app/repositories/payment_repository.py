"""Data access for payments. Extends the invoice repository because every
payment change re-derives the invoice balance."""
from decimal import Decimal
from typing import Optional, Protocol
from uuid import UUID

from app.repositories.invoice_repository import InvoiceRepository, SupabaseInvoiceRepository
from app.repositories.subscription_repository import to_row


class DuplicatePaymentError(Exception):
    """payment_reference is already used (payments.payment_reference is UNIQUE)."""


class PaymentRepository(InvoiceRepository, Protocol):
    def list_payments(self, *, status: Optional[str], invoice_id: Optional[UUID],
                      customer_id: Optional[UUID], limit: int, offset: int) -> list[dict]: ...
    def get_payment(self, payment_id: UUID) -> Optional[dict]: ...
    def get_payment_by_reference(self, reference: str) -> Optional[dict]: ...
    def find_gateway_payment(self, gateway: Optional[str], gateway_payment_id: str) -> Optional[dict]: ...
    def list_invoice_payments(self, invoice_id: UUID) -> list[dict]: ...
    def insert_payment(self, data: dict) -> dict:
        """Raises DuplicatePaymentError when payment_reference already exists."""
        ...
    def update_payment(self, payment_id: UUID, data: dict, expected_status: Optional[str] = None,
                       expected_refunded_amount: Optional[Decimal] = None) -> Optional[dict]:
        """Returns None if the row is missing or no longer matches the expected values."""
        ...


class SupabasePaymentRepository(SupabaseInvoiceRepository):
    def list_payments(self, *, status, invoice_id, customer_id, limit, offset):
        query = self.db.table("payments").select("*")
        if status:
            query = query.eq("status", status)
        if invoice_id:
            query = query.eq("invoice_id", str(invoice_id))
        if customer_id:
            query = query.eq("customer_id", str(customer_id))
        res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return res.data or []

    def get_payment(self, payment_id):
        return self._one("payments", "id", payment_id)

    def get_payment_by_reference(self, reference):
        return self._one("payments", "payment_reference", reference)

    def find_gateway_payment(self, gateway, gateway_payment_id):
        query = self.db.table("payments").select("*").eq("gateway_payment_id", gateway_payment_id)
        query = query.eq("gateway", gateway) if gateway else query.is_("gateway", "null")
        res = query.limit(1).execute()
        return res.data[0] if res.data else None

    def list_invoice_payments(self, invoice_id):
        res = (self.db.table("payments").select("*").eq("invoice_id", str(invoice_id))
               .order("created_at").execute())
        return res.data or []

    def insert_payment(self, data):
        from postgrest.exceptions import APIError

        try:
            return self.db.table("payments").insert(to_row(data)).execute().data[0]
        except APIError as exc:
            if exc.code == "23505":     # unique_violation on payment_reference
                raise DuplicatePaymentError(exc.message) from exc
            raise

    def update_payment(self, payment_id, data, expected_status=None, expected_refunded_amount=None):
        query = self.db.table("payments").update(to_row(data)).eq("id", str(payment_id))
        if expected_status:
            query = query.eq("status", expected_status)
        if expected_refunded_amount is not None:
            query = query.eq("refunded_amount", str(expected_refunded_amount))
        res = query.execute()
        return res.data[0] if res.data else None


def get_payment_repository() -> PaymentRepository:
    """FastAPI dependency; tests override it with an in-memory fake."""
    from app.core.database import get_supabase

    return SupabasePaymentRepository(get_supabase())

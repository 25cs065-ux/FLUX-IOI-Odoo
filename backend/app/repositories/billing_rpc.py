"""Calls into the transactional billing_* Postgres functions
(database/migrations/20261031_billing_transactions.sql).

Used only when BILLING_DB_FUNCTIONS=true, i.e. after the migration has been
approved and applied. Otherwise `transactional` is False and the services keep
their compensating, non-transactional code path.

The same BillingRpcMixin is used by the Supabase repositories (PostgREST
.rpc) and by the real-Postgres test repository (psycopg2), so the exact same
function names and parameters are exercised in tests.
"""
import os
from datetime import date
from decimal import Decimal
from typing import Optional

SQLSTATE_TO_HTTP = {"BL404": 404, "BL409": 409, "BL422": 422}
UNIQUE_VIOLATION = "23505"


class RuleViolation(Exception):
    """A business rule enforced inside the database function."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class UniqueViolation(Exception):
    pass


def enabled() -> bool:
    return os.getenv("BILLING_DB_FUNCTIONS", "").strip().lower() in ("1", "true", "yes")


def to_row(data: dict) -> dict:
    # Imported lazily: subscription_repository imports this module.
    from app.repositories.subscription_repository import to_row as convert

    return convert(data)


def _iso(value) -> Optional[str]:
    return value.isoformat() if isinstance(value, date) else value


class BillingRpcMixin:
    """Transactional operations. Subclasses implement _call_rpc(name, params)."""

    @property
    def transactional(self) -> bool:
        return enabled()

    def _call_rpc(self, name: str, params: dict):
        raise NotImplementedError

    # ---- subscriptions
    def create_subscription_tx(self, header: dict, lines: list[dict], history: dict) -> dict:
        return self._call_rpc("billing_create_subscription", {
            "p_header": to_row(header), "p_lines": [to_row(l) for l in lines], "p_history": to_row(history)})

    def update_subscription_tx(self, subscription_id, expected_status: str, expected_updated_at,
                               changes: dict, lines: Optional[list[dict]]) -> Optional[dict]:
        return self._call_rpc("billing_update_subscription", {
            "p_id": str(subscription_id), "p_expected_status": expected_status,
            "p_expected_updated_at": _iso(expected_updated_at), "p_changes": to_row(changes),
            "p_lines": None if lines is None else [to_row(l) for l in lines]})

    # ---- invoices
    def create_invoice_tx(self, header: dict, lines: list[dict], subscription_id=None,
                          period_start: Optional[date] = None, next_billing_date: Optional[date] = None) -> dict:
        from app.repositories.invoice_repository import DuplicateInvoiceError

        try:
            return self._call_rpc("billing_create_invoice", {
                "p_header": to_row(header), "p_lines": [to_row(l) for l in lines],
                "p_subscription_id": str(subscription_id) if subscription_id else None,
                "p_period_start": _iso(period_start), "p_next_billing_date": _iso(next_billing_date)})
        except UniqueViolation as exc:
            raise DuplicateInvoiceError(str(exc)) from exc

    def update_invoice_tx(self, invoice_id, expected_status: str, expected_updated_at,
                          changes: dict, lines: Optional[list[dict]]) -> Optional[dict]:
        return self._call_rpc("billing_update_invoice", {
            "p_id": str(invoice_id), "p_expected_status": expected_status,
            "p_expected_updated_at": _iso(expected_updated_at), "p_changes": to_row(changes),
            "p_lines": None if lines is None else [to_row(l) for l in lines]})

    def void_invoice_tx(self, invoice_id) -> dict:
        return self._call_rpc("billing_void_invoice", {"p_invoice_id": str(invoice_id)})

    def cancel_invoice_tx(self, invoice_id) -> dict:
        return self._call_rpc("billing_cancel_invoice", {"p_invoice_id": str(invoice_id)})

    # ---- payments
    def record_payment_tx(self, payment: dict, today: date) -> dict:
        from app.repositories.payment_repository import DuplicatePaymentError

        try:
            return self._call_rpc("billing_record_payment", {"p_payment": to_row(payment),
                                                             "p_today": today.isoformat()})
        except UniqueViolation as exc:
            raise DuplicatePaymentError(str(exc)) from exc

    def change_payment_tx(self, payment_id, action: str, today: date,
                          amount: Optional[Decimal] = None, note: Optional[str] = None) -> dict:
        return self._call_rpc("billing_change_payment", {
            "p_payment_id": str(payment_id), "p_action": action,
            "p_amount": None if amount is None else str(amount), "p_note": note,
            "p_today": today.isoformat()})

    def recalculate_invoice_tx(self, invoice_id, today: date) -> dict:
        return self._call_rpc("billing_recalculate_invoice", {"p_invoice_id": str(invoice_id),
                                                              "p_today": today.isoformat()})


def call_supabase(client, name: str, params: dict):
    from postgrest.exceptions import APIError

    try:
        return client.rpc(name, params).execute().data
    except APIError as exc:
        if exc.code in SQLSTATE_TO_HTTP:
            raise RuleViolation(SQLSTATE_TO_HTTP[exc.code], exc.message) from exc
        if exc.code == UNIQUE_VIOLATION:
            raise UniqueViolation(exc.message) from exc
        raise

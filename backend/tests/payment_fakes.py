"""In-memory stand-in for PaymentRepository used by the payment tests."""
import copy
from datetime import datetime, timezone
from decimal import Decimal

from app.repositories.payment_repository import DuplicatePaymentError
from app.repositories.subscription_repository import to_row
from invoice_fakes import FakeInvoiceRepository
from subscription_fakes import new_id


class FakePaymentRepository(FakeInvoiceRepository):
    def __init__(self):
        super().__init__()
        self.payments = {}
        self.fail_invoice_update = False    # simulate a DB failure while updating the balance
        self.after_payment_insert = None    # hook to simulate a concurrent request

    def update_invoice(self, invoice_id, data, expected_status=None, expected_amount_paid=None):
        if self.fail_invoice_update:
            raise RuntimeError("simulated database failure")
        return super().update_invoice(invoice_id, data, expected_status, expected_amount_paid)

    def list_payments(self, *, status, invoice_id, customer_id, limit, offset):
        rows = [p for p in self.payments.values()
                if (not status or p["status"] == status)
                and (not invoice_id or p["invoice_id"] == str(invoice_id))
                and (not customer_id or p["customer_id"] == str(customer_id))]
        rows.sort(key=lambda p: p["created_at"], reverse=True)
        return copy.deepcopy(rows[offset:offset + limit])

    def get_payment(self, payment_id):
        return self._get(self.payments, payment_id)

    def get_payment_by_reference(self, reference):
        return next((copy.deepcopy(p) for p in self.payments.values()
                     if p["payment_reference"] == reference), None)

    def find_gateway_payment(self, gateway, gateway_payment_id):
        return next((copy.deepcopy(p) for p in self.payments.values()
                     if p["gateway_payment_id"] == gateway_payment_id and p["gateway"] == gateway), None)

    def list_invoice_payments(self, invoice_id):
        rows = [p for p in self.payments.values() if p["invoice_id"] == str(invoice_id)]
        return copy.deepcopy(sorted(rows, key=lambda p: p["created_at"]))

    def insert_payment(self, data):
        self._record("payments", "insert", data)
        if self.get_payment_by_reference(data["payment_reference"]):
            raise DuplicatePaymentError("payments_payment_reference_key")
        row = {
            "id": new_id(), "gateway": None, "gateway_payment_id": None, "gateway_response": {},
            "refunded_amount": "0.00", "refunded_at": None, "notes": None,
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": None, **to_row(data),
        }
        self.payments[row["id"]] = row
        if self.after_payment_insert:
            hook, self.after_payment_insert = self.after_payment_insert, None
            hook()
        return copy.deepcopy(row)

    def update_payment(self, payment_id, data, expected_status=None, expected_refunded_amount=None):
        self._record("payments", "update", data)
        row = self.payments.get(str(payment_id))
        if not row or (expected_status and row["status"] != expected_status):
            return None
        if expected_refunded_amount is not None and \
                Decimal(str(row["refunded_amount"])) != Decimal(str(expected_refunded_amount)):
            return None
        row.update(to_row(data))
        return copy.deepcopy(row)

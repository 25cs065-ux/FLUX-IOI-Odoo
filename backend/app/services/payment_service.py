"""Payment business rules: recording, confirmation, refunds and invoice balances.

Consistency model
  invoices.amount_paid is never incremented. It is always re-derived from the
  invoice's payments (completed amounts minus refunds) by
  sync_invoice_balance(), using a compare-and-set on amount_paid. Re-running
  it is safe, so a failure after a payment write is repaired by compensating
  the payment and re-syncing (or by POST /payments/recalculate/{invoice_id}).

Void vs payment
  record_payment re-reads the invoice status after inserting the payment;
  void_invoice re-reads the payments after writing the void. Whichever runs
  second sees the other and backs out (payment marked failed / void undone).

Duplicates and overpayment
  * payment_reference is an idempotency key: replaying the same request
    returns the original payment instead of recording a second one.
  * gateway_payment_id is checked per gateway for the same reason.
  * pending + completed payments may never exceed the invoice total; this is
    checked before the insert and re-checked after it to catch races.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from app.core.current_user import CurrentUser, Role
from app.repositories.payment_repository import DuplicatePaymentError, PaymentRepository
from app.schemas.invoice import InvoiceStatus as I
from app.schemas.payment import PaymentCreate, PaymentStatus as P, RefundRequest
from app.services.subscription_service import (
    ConflictError,
    NotFoundError,
    ValidationError,
    _date,
    _dec,
    _now,
    own_customer_id,
)

PAYABLE_INVOICE_STATUSES = {I.SENT.value, I.PARTIAL.value, I.OVERDUE.value}
BALANCE_INVOICE_STATUSES = PAYABLE_INVOICE_STATUSES | {I.PAID.value}
COUNTED_PAYMENT_STATUSES = {P.COMPLETED.value, P.PARTIALLY_REFUNDED.value, P.REFUNDED.value}
REFUNDABLE_PAYMENT_STATUSES = {P.COMPLETED.value, P.PARTIALLY_REFUNDED.value}
SYNC_ATTEMPTS = 3


# ---------------------------------------------------------------- balance

def net_paid(payments: list[dict]) -> Decimal:
    return sum((_dec(p["amount"]) - _dec(p.get("refunded_amount") or 0)
                for p in payments if p["status"] in COUNTED_PAYMENT_STATUSES), Decimal("0.00"))


def pending_total(payments: list[dict]) -> Decimal:
    return sum((_dec(p["amount"]) for p in payments if p["status"] == P.PENDING.value), Decimal("0.00"))


def derive_invoice_status(total: Decimal, paid: Decimal, due_date: date, today: date) -> str:
    if paid >= total:
        return I.PAID.value
    if due_date < today:
        return I.OVERDUE.value
    return I.PARTIAL.value if paid > 0 else I.SENT.value


def sync_invoice_balance(repo: PaymentRepository, invoice_id, today: Optional[date] = None) -> dict:
    """Re-derive amount_paid / status / paid_at from the invoice's payments."""
    today = today or date.today()
    for _ in range(SYNC_ATTEMPTS):
        inv = repo.get_invoice(invoice_id)
        if not inv:
            raise NotFoundError("Invoice not found")
        if inv["status"] not in BALANCE_INVOICE_STATUSES:
            return inv          # draft / void / cancelled never carry a balance
        paid = net_paid(repo.list_invoice_payments(invoice_id))
        current_paid = _dec(inv["amount_paid"])
        status = derive_invoice_status(_dec(inv["total_amount"]), paid, _date(inv["due_date"]), today)

        data = {}
        if paid != current_paid:
            data["amount_paid"] = paid
        if status != inv["status"]:
            data["status"] = status
            data["paid_at"] = _now() if status == I.PAID.value else None
        if not data:
            return inv
        data["updated_at"] = _now()
        updated = repo.update_invoice(invoice_id, data, expected_status=inv["status"],
                                      expected_amount_paid=current_paid)
        if updated:
            return updated
    raise ConflictError("Invoice balance is being updated concurrently; retry the request")


# ---------------------------------------------------------------- access

def get_payment(repo: PaymentRepository, payment_id: UUID, user: CurrentUser) -> dict:
    """Customers only see their own payments; anything else is 404."""
    payment = repo.get_payment(payment_id)
    if not payment:
        raise NotFoundError("Payment not found")
    if user.role == Role.CUSTOMER and str(payment["customer_id"]) != own_customer_id(repo, user):
        raise NotFoundError("Payment not found")
    return payment


def list_payments(repo, user, *, status=None, invoice_id=None, customer_id=None,
                  limit=50, offset=0) -> list[dict]:
    if user.role == Role.CUSTOMER:
        customer_id = own_customer_id(repo, user)
        if customer_id is None:
            return []
    return repo.list_payments(status=status.value if status else None, invoice_id=invoice_id,
                              customer_id=customer_id, limit=limit, offset=offset)


def _result(repo, payment: dict, invoice: Optional[dict] = None) -> dict:
    return {"payment": payment, "invoice": invoice or repo.get_invoice(payment["invoice_id"])}


# ---------------------------------------------------------------- record

def _append_note(existing: Optional[str], note: str) -> str:
    return f"{existing}\n{note}" if existing else note


def _replay(repo, existing: dict, payload: PaymentCreate, key: str) -> dict:
    same = (str(existing["invoice_id"]) == str(payload.invoice_id)
            and _dec(existing["amount"]) == payload.amount
            and existing["status"] != P.FAILED.value)
    if not same:
        raise ConflictError(f"{key} was already used for a different payment")
    return _result(repo, existing)


def _mark_failed(repo, payment: dict, note: str) -> None:
    """Compensation: failed payments are excluded from every balance."""
    try:
        repo.update_payment(payment["id"], {
            "status": P.FAILED.value, "notes": _append_note(payment.get("notes"), note),
            "updated_at": _now(),
        })
    except Exception:
        pass


def _resync_quietly(repo, invoice_id, today) -> None:
    try:
        sync_invoice_balance(repo, invoice_id, today)
    except Exception:
        pass            # POST /payments/recalculate/{invoice_id} repairs it later


def record_payment(repo: PaymentRepository, payload: PaymentCreate, user: CurrentUser,
                   today: Optional[date] = None) -> tuple[dict, bool]:
    """Returns (result, created). created is False for an idempotent replay."""
    today = today or date.today()
    if payload.payment_date and payload.payment_date > today:
        raise ValidationError("payment_date cannot be in the future")
    inv = repo.get_invoice(payload.invoice_id)
    if not inv:
        raise NotFoundError("Invoice not found")

    if payload.payment_reference:
        existing = repo.get_payment_by_reference(payload.payment_reference)
        if existing:
            return _replay(repo, existing, payload, "payment_reference"), False
    if payload.gateway_payment_id:
        existing = repo.find_gateway_payment(payload.gateway, payload.gateway_payment_id)
        if existing:
            return _replay(repo, existing, payload, "gateway_payment_id"), False

    if inv["status"] not in PAYABLE_INVOICE_STATUSES:
        raise ConflictError(f"Payments cannot be recorded against a {inv['status']} invoice")
    if payload.currency and payload.currency != inv["currency"]:
        raise ValidationError(f"Currency must match the invoice currency ({inv['currency']})")
    total = _dec(inv["total_amount"])
    payments = repo.list_invoice_payments(inv["id"])
    outstanding = total - net_paid(payments) - pending_total(payments)
    if payload.amount > outstanding:
        raise ConflictError(f"Payment exceeds the outstanding balance of {outstanding}")

    try:
        payment = repo.insert_payment({
            "payment_reference": payload.payment_reference or f"PAY-{uuid.uuid4().hex[:12].upper()}",
            "invoice_id": inv["id"],
            "customer_id": inv["customer_id"],
            "method": payload.method.value,
            "status": payload.status,
            "amount": payload.amount,
            "currency": inv["currency"],
            "payment_date": payload.payment_date or today,
            "gateway": payload.gateway,
            "gateway_payment_id": payload.gateway_payment_id,
            "gateway_response": payload.gateway_response,
            "notes": payload.notes,
            "recorded_by": user.id,
        })
    except DuplicatePaymentError:
        # Lost a race with an identical request.
        existing = repo.get_payment_by_reference(payload.payment_reference)
        if not existing:
            raise
        return _replay(repo, existing, payload, "payment_reference"), False

    try:
        # Re-check after inserting: void_invoice does the mirror-image check,
        # so a concurrent void and payment can never both succeed.
        current = repo.get_invoice(inv["id"])
        if not current or current["status"] not in PAYABLE_INVOICE_STATUSES:
            raise ConflictError("The invoice was voided or cancelled while this payment was being recorded")
        others = [p for p in repo.list_invoice_payments(inv["id"]) if str(p["id"]) != str(payment["id"])]
        if payload.amount > total - net_paid(others) - pending_total(others):
            raise ConflictError("Another payment was recorded at the same time; "
                                "this one would overpay the invoice")
        invoice = sync_invoice_balance(repo, inv["id"], today)
    except Exception as exc:
        _mark_failed(repo, payment, f"Rolled back: {getattr(exc, 'detail', None) or 'invoice update failed'}")
        _resync_quietly(repo, inv["id"], today)
        raise
    return _result(repo, repo.get_payment(payment["id"]) or payment, invoice), True


# ---------------------------------------------------------------- pending payments

def confirm_payment(repo, payment_id, user, today=None) -> dict:
    """pending -> completed (e.g. gateway capture succeeded)."""
    payment = get_payment(repo, payment_id, user)
    if payment["status"] != P.PENDING.value:
        raise ConflictError(f"Only pending payments can be confirmed (status is {payment['status']})")
    updated = repo.update_payment(payment_id, {"status": P.COMPLETED.value, "updated_at": _now()},
                                  expected_status=P.PENDING.value)
    if not updated:
        raise ConflictError("Payment was changed by someone else; reload and try again")
    try:
        invoice = sync_invoice_balance(repo, payment["invoice_id"], today)
    except Exception:
        repo.update_payment(payment_id, {"status": P.PENDING.value, "updated_at": _now()},
                            expected_status=P.COMPLETED.value)
        _resync_quietly(repo, payment["invoice_id"], today)
        raise
    return _result(repo, updated, invoice)


def fail_payment(repo, payment_id, user, today=None) -> dict:
    """pending -> failed (releases the amount it reserved on the invoice)."""
    payment = get_payment(repo, payment_id, user)
    if payment["status"] != P.PENDING.value:
        raise ConflictError(f"Only pending payments can be marked failed (status is {payment['status']})")
    updated = repo.update_payment(payment_id, {"status": P.FAILED.value, "updated_at": _now()},
                                  expected_status=P.PENDING.value)
    if not updated:
        raise ConflictError("Payment was changed by someone else; reload and try again")
    return _result(repo, updated)


# ---------------------------------------------------------------- refunds

def refund_payment(repo: PaymentRepository, payment_id: UUID, payload: RefundRequest,
                   user: CurrentUser, today: Optional[date] = None) -> dict:
    payment = get_payment(repo, payment_id, user)
    if payment["status"] not in REFUNDABLE_PAYMENT_STATUSES:
        raise ConflictError(f"A {payment['status']} payment cannot be refunded")
    amount, already = _dec(payment["amount"]), _dec(payment.get("refunded_amount") or 0)
    refundable = amount - already
    refund = payload.amount or refundable
    if refund > refundable:
        raise ConflictError(f"Refund exceeds the refundable amount of {refundable}")

    total_refunded = already + refund
    note = f"Refund of {refund}" + (f": {payload.reason}" if payload.reason else "")
    updated = repo.update_payment(payment_id, {
        "refunded_amount": total_refunded,
        "status": P.REFUNDED.value if total_refunded == amount else P.PARTIALLY_REFUNDED.value,
        "refunded_at": _now(),
        "notes": _append_note(payment.get("notes"), note),
        "updated_at": _now(),
    }, expected_status=payment["status"], expected_refunded_amount=already)
    if not updated:
        raise ConflictError("Payment was changed by someone else; reload and try again")

    try:
        invoice = sync_invoice_balance(repo, payment["invoice_id"], today)
    except Exception:
        repo.update_payment(payment_id, {
            "refunded_amount": already, "status": payment["status"],
            "refunded_at": payment.get("refunded_at"), "notes": payment.get("notes"),
            "updated_at": _now(),
        }, expected_refunded_amount=total_refunded)
        _resync_quietly(repo, payment["invoice_id"], today)
        raise
    return _result(repo, updated, invoice)

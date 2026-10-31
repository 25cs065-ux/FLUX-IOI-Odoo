"""Invoice business rules: generation from subscriptions, billing periods,
due dates, totals and invoice status changes.

Status flow (database/remaining_schema.sql):
    draft -> sent -> overdue                (mark-overdue billing job)
    draft -> cancelled
    sent / overdue (nothing paid) -> void
    sent / overdue -> partial -> paid       (driven by the Payments module)
"""
import calendar
import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from app.core.current_user import CurrentUser, Role
from app.repositories.invoice_repository import DuplicateInvoiceError, InvoiceRepository
from app.schemas.invoice import InvoiceCreate, InvoiceStatus as I, InvoiceUpdate
from app.schemas.payment import PaymentStatus as P
from app.services.subscription_service import (
    ConflictError,
    NotFoundError,
    SubscriptionError,
    ValidationError,
    _date,
    _dec,
    _first_billing_date,
    _now,
    _require_active,
    build_lines,
    db_rules,
    own_customer_id,
    price_line,
    save_with_lines,
    transactional,
)
from app.services.tax_engine import money

logger = logging.getLogger(__name__)

MAX_PERIODS_PER_RUN = 36            # safety cap when catching up on missed periods
CUSTOMER_HIDDEN_STATUSES = (I.DRAFT.value,)


# ---------------------------------------------------------------- billing periods

def add_months(day: date, months: int) -> date:
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def billing_period_end(anchor: date, period_start: date, interval: str) -> date:
    """Last day of the period starting at period_start. Monthly/yearly periods
    are anchored to the first billing date so Jan 31 -> Feb 28 -> Mar 31."""
    if interval == "daily":
        return period_start
    if interval == "weekly":
        return period_start + timedelta(days=6)
    step = {"monthly": 1, "yearly": 12}.get(interval)
    if step is None:
        raise ConflictError(f"Unsupported plan interval '{interval}'")
    elapsed = (period_start.year - anchor.year) * 12 + period_start.month - anchor.month
    return add_months(anchor, elapsed + step) - timedelta(days=1)


def due_date_for(repo: InvoiceRepository, issue_date: date, payment_terms_id) -> date:
    """issue_date + payment_terms.days_due; due on receipt without terms."""
    if not payment_terms_id:
        return issue_date
    terms = repo.get_payment_terms(payment_terms_id)
    return issue_date + timedelta(days=int((terms or {}).get("days_due") or 0))


# ---------------------------------------------------------------- totals

def invoice_totals(lines: list[dict]) -> dict:
    zero = Decimal("0.00")
    taxes = {(l.get("tax_name"), _dec(l["tax_rate"])) for l in lines if l.get("tax_id")}
    tax_name, tax_rate = taxes.pop() if len(taxes) == 1 else (None, None)   # single-tax snapshot
    return {
        "subtotal": sum((_dec(l["subtotal"]) for l in lines), zero),
        "discount_amount": sum((_dec(l["discount_amount"]) for l in lines), zero),
        "tax_amount": sum((_dec(l["tax_amount"]) for l in lines), zero),
        "total_amount": sum((_dec(l["line_total"]) for l in lines), zero),
        "tax_name": tax_name,
        "tax_rate": tax_rate,
    }


def lines_from_subscription(repo: InvoiceRepository, rows: list[dict]) -> list[dict]:
    """Copy subscription lines at their contracted price; re-snapshot the tax
    (current name/rate) as of the invoice date."""
    lines, tax_cache = [], {}
    for row in rows:
        tax_id = row.get("tax_id")
        tax = None
        if tax_id:
            tax = tax_cache.setdefault(str(tax_id), repo.get_tax(tax_id))
        rate = _dec(tax.get("rate") or 0) if tax else None
        lines.append({
            "subscription_line_id": row["id"],
            "product_id": row.get("product_id"),
            "variant_id": row.get("variant_id"),
            "sequence": row.get("sequence") or 10,
            "description": row["description"],
            "quantity": _dec(row["quantity"]),
            "unit_price": money(row["unit_price"]),
            "discount_percent": _dec(row.get("discount_percent") or 0),
            "tax_id": tax_id if tax else None,
            "tax_name": tax.get("name") if tax else None,
            "tax_rate": rate,
            **price_line(row["quantity"], row["unit_price"], row.get("discount_percent") or 0, rate),
        })
    return lines


# ---------------------------------------------------------------- access

def get_invoice(repo: InvoiceRepository, invoice_id: UUID, user: CurrentUser) -> dict:
    """Customers see only their own, non-draft invoices; anything else is 404."""
    inv = repo.get_invoice(invoice_id)
    if not inv:
        raise NotFoundError("Invoice not found")
    if user.role == Role.CUSTOMER and (
        inv["status"] in CUSTOMER_HIDDEN_STATUSES or str(inv["customer_id"]) != own_customer_id(repo, user)
    ):
        raise NotFoundError("Invoice not found")
    return inv


def get_invoice_detail(repo, invoice_id, user) -> dict:
    inv = get_invoice(repo, invoice_id, user)
    return {**inv, "lines": repo.list_invoice_lines(invoice_id)}


def list_invoices(repo, user, *, status=None, customer_id=None, subscription_id=None,
                  limit=50, offset=0) -> list[dict]:
    exclude: tuple = ()
    if user.role == Role.CUSTOMER:
        customer_id = own_customer_id(repo, user)
        if customer_id is None or (status and status.value in CUSTOMER_HIDDEN_STATUSES):
            return []
        exclude = CUSTOMER_HIDDEN_STATUSES
    return repo.list_invoices(status=status.value if status else None, customer_id=customer_id,
                              subscription_id=subscription_id, exclude_statuses=exclude,
                              limit=limit, offset=offset)


# ---------------------------------------------------------------- create

class PeriodAlreadyInvoiced(ConflictError):
    """The period has a live invoice. bill_subscription advances
    next_billing_date past it before raising, so billing can continue."""

    def __init__(self, invoice: Optional[dict] = None):
        number = f" ({invoice['invoice_number']})" if invoice and invoice.get("invoice_number") else ""
        super().__init__(f"This billing period has already been invoiced{number}")
        self.invoice = invoice


def _save(repo: InvoiceRepository, header: dict, lines: list[dict]) -> dict:
    if transactional(repo):
        try:
            with db_rules():
                saved = repo.create_invoice_tx(header, lines)
        except DuplicateInvoiceError as exc:
            raise PeriodAlreadyInvoiced() from exc
        return {**saved["invoice"], "lines": saved["lines"]}
    try:
        inv = repo.insert_invoice(header)
    except DuplicateInvoiceError as exc:
        raise PeriodAlreadyInvoiced() from exc
    try:
        saved = repo.insert_invoice_lines([{**l, "invoice_id": inv["id"]} for l in lines])
    except Exception:
        repo.delete_invoice(inv["id"])      # no REST transactions; undo the header
        raise
    return {**inv, "lines": saved}


def create_invoice(repo: InvoiceRepository, payload: InvoiceCreate, user: CurrentUser,
                   today: Optional[date] = None) -> dict:
    _require_active(repo.get_customer, payload.customer_id, "Customer")
    if payload.subscription_id:
        sub = repo.get_subscription(payload.subscription_id)
        if not sub or str(sub["customer_id"]) != str(payload.customer_id):
            raise ValidationError("Subscription not found for this customer")
    if payload.payment_terms_id:
        _require_active(repo.get_payment_terms, payload.payment_terms_id, "Payment terms")

    issue = payload.issue_date or today or date.today()
    due = payload.due_date or due_date_for(repo, issue, payload.payment_terms_id)
    if due < issue:
        raise ValidationError("due_date cannot be before issue_date")
    lines = build_lines(repo, payload.lines, snapshot_tax=True)
    header = {
        "customer_id": payload.customer_id,
        "subscription_id": payload.subscription_id,
        "payment_terms_id": payload.payment_terms_id,
        "status": I.DRAFT.value,
        "issue_date": issue,
        "due_date": due,
        "currency": payload.currency,
        "notes": payload.notes,
        "terms_and_conditions": payload.terms_and_conditions,
        "created_by": user.id,
        **invoice_totals(lines),
    }
    return _save(repo, header, lines)


def bill_subscription(repo: InvoiceRepository, sub: dict, user: CurrentUser, issue_date: date) -> dict:
    """Invoice the subscription's next billing period and advance next_billing_date."""
    if sub["status"] != "active":
        raise ConflictError(f"Only active subscriptions can be invoiced (status is {sub['status']})")
    period_start = _date(sub.get("next_billing_date"))
    end = _date(sub.get("end_date"))
    if period_start is None or (end and period_start > end):
        raise ConflictError("Nothing left to bill: the subscription has reached its end date")
    plan = repo.get_plan(sub["plan_id"])
    if not plan:
        raise ConflictError("Subscription plan no longer exists")

    anchor = _first_billing_date(_date(sub["start_date"]), _date(sub.get("trial_end_date")))
    period_end = billing_period_end(anchor, period_start, plan.get("interval") or "monthly")
    if end:
        period_end = min(period_end, end)
    existing = repo.find_live_invoice(sub["id"], period_start, period_end)
    if existing:
        # A previous run saved this invoice but stopped before advancing the
        # subscription. Finish that step instead of getting stuck on this period.
        _advance_billing_date(repo, sub, period_end, end)
        raise PeriodAlreadyInvoiced(existing)
    rows = repo.list_lines(sub["id"])
    if not rows:
        raise ConflictError("Subscription has no lines to invoice")

    lines = lines_from_subscription(repo, rows)
    header = {
        "customer_id": sub["customer_id"],
        "subscription_id": sub["id"],
        "payment_terms_id": sub.get("payment_terms_id"),
        "status": I.DRAFT.value,
        "issue_date": issue_date,
        "due_date": due_date_for(repo, issue_date, sub.get("payment_terms_id")),
        "billing_period_start": period_start,
        "billing_period_end": period_end,
        "currency": sub.get("currency") or "INR",
        "created_by": user.id,
        **invoice_totals(lines),
    }
    if transactional(repo):
        # Invoice, lines and next_billing_date are written in one transaction.
        try:
            with db_rules():
                saved = repo.create_invoice_tx(header, lines, sub["id"], period_start,
                                               _next_billing_date(period_end, end))
        except DuplicateInvoiceError as exc:
            _advance_billing_date(repo, sub, period_end, end)
            raise PeriodAlreadyInvoiced() from exc
        return {**saved["invoice"], "lines": saved["lines"]}

    try:
        inv = _save(repo, header, lines)
    except PeriodAlreadyInvoiced:
        # Lost a race with a concurrent run (uix_invoice_live_period).
        _advance_billing_date(repo, sub, period_end, end)
        raise

    # If this fails the invoice stays valid; the next run finds it via
    # find_live_invoice and advances the date then.
    _advance_billing_date(repo, sub, period_end, end)
    return inv


def _advance_billing_date(repo: InvoiceRepository, sub: dict, period_end: date, end: Optional[date]) -> None:
    """Move next_billing_date past period_end. Idempotent: every caller
    for the same period writes the same value."""
    repo.update_subscription(sub["id"], {
        "next_billing_date": _next_billing_date(period_end, end),
        "updated_at": _now(),
    }, expected_status="active")


def _next_billing_date(period_end: date, end: Optional[date]) -> Optional[date]:
    next_start = period_end + timedelta(days=1)
    return None if end and next_start > end else next_start


def generate_invoice(repo, subscription_id: UUID, user, issue_date: Optional[date] = None) -> dict:
    sub = repo.get_subscription(subscription_id)
    if not sub:
        raise NotFoundError("Subscription not found")
    return bill_subscription(repo, sub, user, issue_date or date.today())


def billing_run(repo: InvoiceRepository, user: CurrentUser, as_of: Optional[date] = None) -> dict:
    """Invoice every active subscription whose next billing date has arrived,
    catching up on missed periods. One subscription's problem never stops the
    run: business-rule refusals are reported as skipped, unexpected errors as
    failed, and periods that were already invoiced as recovered."""
    as_of = as_of or date.today()
    result = {"created": [], "recovered": [], "skipped": [], "failed": []}
    for sub in repo.list_billable_subscriptions(as_of):
        try:
            _bill_until(repo, sub, user, as_of, result)
        except Exception as exc:
            logger.exception("Billing run failed for subscription %s", sub["id"])
            result["failed"].append({"subscription_id": sub["id"],
                                     "reason": f"{type(exc).__name__}: {exc}"[:300]})
    return result


def _bill_until(repo, sub: dict, user, as_of: date, result: dict) -> None:
    for _ in range(MAX_PERIODS_PER_RUN):
        try:
            result["created"].append(bill_subscription(repo, sub, user, as_of))
        except PeriodAlreadyInvoiced as exc:
            result["recovered"].append({"subscription_id": sub["id"], "reason": exc.detail})
        except SubscriptionError as exc:
            result["skipped"].append({"subscription_id": sub["id"], "reason": exc.detail})
            return
        sub = repo.get_subscription(sub["id"])
        next_date = _date(sub.get("next_billing_date")) if sub else None
        if next_date is None or next_date > as_of:
            return


# ---------------------------------------------------------------- update

def update_invoice(repo: InvoiceRepository, invoice_id: UUID, payload: InvoiceUpdate,
                   user: CurrentUser) -> dict:
    inv = get_invoice(repo, invoice_id, user)
    changes = payload.model_dump(exclude_unset=True, exclude={"lines"})
    lines_given = "lines" in payload.model_fields_set
    if not changes and not lines_given:
        raise ValidationError("No fields provided to update")
    if inv["status"] != I.DRAFT.value and (lines_given or set(changes) - {"notes"}):
        raise ConflictError(f"Only notes can be changed once an invoice is {inv['status']}")
    if lines_given and not payload.lines:
        raise ValidationError("An invoice needs at least one line")
    for field in ("issue_date", "due_date"):
        if field in changes and changes[field] is None:
            raise ValidationError(f"{field} cannot be null")
    if changes.get("payment_terms_id"):
        _require_active(repo.get_payment_terms, changes["payment_terms_id"], "Payment terms")

    issue = changes.get("issue_date") or _date(inv["issue_date"])
    if "due_date" not in changes and {"issue_date", "payment_terms_id"} & set(changes):
        terms_id = changes["payment_terms_id"] if "payment_terms_id" in changes else inv.get("payment_terms_id")
        changes["due_date"] = due_date_for(repo, issue, terms_id)
    due = changes.get("due_date") or _date(inv["due_date"])
    if due < issue:
        raise ValidationError("due_date cannot be before issue_date")

    new_lines = None
    if lines_given:
        new_lines = build_lines(repo, payload.lines, snapshot_tax=True)
        changes.update(invoice_totals(new_lines))
    changes["updated_at"] = _now()

    if transactional(repo):
        with db_rules():
            saved = repo.update_invoice_tx(invoice_id, inv["status"], inv.get("updated_at"), changes, new_lines)
        if not saved:
            raise ConflictError("Invoice was changed by someone else; reload and try again")
        return {**saved["invoice"], "lines": saved["lines"]}

    updated = save_with_lines(
        old_line_ids=[l["id"] for l in repo.list_invoice_lines(invoice_id)] if new_lines is not None else [],
        insert_lines=(lambda: repo.insert_invoice_lines([{**l, "invoice_id": invoice_id} for l in new_lines]))
        if new_lines is not None else None,
        delete_lines=repo.delete_invoice_lines_by_ids,
        update_header=lambda: repo.update_invoice(invoice_id, changes, expected_status=inv["status"],
                                                  expected_updated_at=inv.get("updated_at")),
        restore_header=lambda saved: repo.update_invoice(
            invoice_id, {k: inv.get(k) for k in changes}, expected_updated_at=saved["updated_at"]),
        conflict_message="Invoice was changed by someone else; reload and try again",
    )
    return {**updated, "lines": repo.list_invoice_lines(invoice_id)}


# ---------------------------------------------------------------- status changes

def _set_status(repo, inv: dict, to_status: I, allowed_from: set, fields: Optional[dict] = None,
                expected_amount_paid=None) -> dict:
    if inv["status"] not in {s.value for s in allowed_from}:
        allowed = ", ".join(sorted(s.value for s in allowed_from))
        raise ConflictError(f"Cannot move a {inv['status']} invoice to {to_status.value} (allowed from: {allowed})")
    updated = repo.update_invoice(inv["id"], {"status": to_status.value, "updated_at": _now(), **(fields or {})},
                                  expected_status=inv["status"], expected_amount_paid=expected_amount_paid)
    if not updated:
        raise ConflictError("Invoice was changed by someone else; reload and try again")
    return updated


def _release_billing_period(repo: InvoiceRepository, inv: dict) -> None:
    """When the latest period's invoice is cancelled/voided, rewind the
    subscription so the billing run invoices that period again."""
    start, end = _date(inv.get("billing_period_start")), _date(inv.get("billing_period_end"))
    if not (inv.get("subscription_id") and start and end):
        return
    sub = repo.get_subscription(inv["subscription_id"])
    if not sub or sub["status"] not in ("active", "paused"):
        return
    next_date, sub_end = _date(sub.get("next_billing_date")), _date(sub.get("end_date"))
    is_latest = next_date == end + timedelta(days=1) or (next_date is None and sub_end == end)
    if is_latest:
        repo.update_subscription(sub["id"], {"next_billing_date": start, "updated_at": _now()},
                                 expected_status=sub["status"])


def send_invoice(repo, invoice_id, user) -> dict:
    inv = get_invoice(repo, invoice_id, user)
    fields = {"sent_at": _now()}
    if inv["status"] == I.DRAFT.value and _dec(inv["total_amount"]) == 0:
        return _set_status(repo, inv, I.PAID, {I.DRAFT}, {**fields, "paid_at": _now()})
    return _set_status(repo, inv, I.SENT, {I.DRAFT}, fields)


def cancel_invoice(repo, invoice_id, user) -> dict:
    inv = get_invoice(repo, invoice_id, user)
    if transactional(repo):
        with db_rules():
            return repo.cancel_invoice_tx(invoice_id)
    updated = _set_status(repo, inv, I.CANCELLED, {I.DRAFT})
    _release_billing_period(repo, inv)
    return updated


def _live_payments(repo: InvoiceRepository, invoice_id) -> list[dict]:
    """Pending payments, and completed ones not fully refunded."""
    return [p for p in repo.list_invoice_payments(invoice_id)
            if p["status"] == P.PENDING.value
            or (p["status"] in (P.COMPLETED.value, P.PARTIALLY_REFUNDED.value)
                and _dec(p["amount"]) > _dec(p.get("refunded_amount") or 0))]


def void_invoice(repo, invoice_id, user) -> dict:
    """Payment recording re-reads the invoice status after inserting, and void
    re-reads the payments after writing; whichever runs second backs out, so a
    payment can never end up on a void invoice. With database functions the
    invoice row lock makes the two operations strictly sequential instead."""
    inv = get_invoice(repo, invoice_id, user)
    if transactional(repo):
        with db_rules():
            return repo.void_invoice_tx(invoice_id)
    if inv["status"] in (I.SENT.value, I.OVERDUE.value) and (
            _dec(inv.get("amount_paid") or 0) > 0 or _live_payments(repo, inv["id"])):
        raise ConflictError("Invoice has payments recorded or pending; refund or fail them before voiding")
    updated = _set_status(repo, inv, I.VOID, {I.SENT, I.OVERDUE}, {"voided_at": _now()},
                          expected_amount_paid=Decimal("0"))
    if _live_payments(repo, inv["id"]):
        repo.update_invoice(inv["id"], {"status": inv["status"], "voided_at": None, "updated_at": _now()},
                            expected_status=I.VOID.value)
        raise ConflictError("A payment was recorded while voiding; the invoice was not voided")
    _release_billing_period(repo, inv)
    return updated


def mark_overdue(repo: InvoiceRepository, as_of: Optional[date] = None) -> list[str]:
    """Billing job: sent / partial invoices past their due date become overdue."""
    as_of = as_of or date.today()
    marked = []
    for inv in repo.list_overdue_candidates(as_of):
        if repo.update_invoice(inv["id"], {"status": I.OVERDUE.value, "updated_at": _now()},
                               expected_status=inv["status"]):
            marked.append(inv["id"])
    return marked

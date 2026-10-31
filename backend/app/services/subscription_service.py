"""Subscription business rules: validation, pricing, lifecycle and renewal.

Lifecycle (see database/remaining_schema.sql):
    draft -> quotation -> confirmed -> active <-> paused
    draft/quotation -> confirmed            (confirm)
    any non-closed status -> closed         (close / cancel / reject)
    active -> active                        (renew: extends end_date)
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from app.core.current_user import CurrentUser, Role
from app.repositories.subscription_repository import SubscriptionRepository
from app.schemas.subscription import (
    RenewRequest,
    SubscriptionCreate,
    SubscriptionLineInput,
    SubscriptionStatus as S,
    SubscriptionUpdate,
    _check_dates,
)
from app.services.tax_engine import calculate_tax, money


class SubscriptionError(Exception):
    status_code = 400

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class NotFoundError(SubscriptionError):
    status_code = 404


class ForbiddenError(SubscriptionError):
    status_code = 403


class ConflictError(SubscriptionError):
    status_code = 409


class ValidationError(SubscriptionError):
    status_code = 422


EDITABLE_STATUSES = {S.DRAFT.value, S.QUOTATION.value}
ALWAYS_EDITABLE_FIELDS = {"notes", "auto_renew"}
NON_NULLABLE_FIELDS = {"plan_id", "quantity", "start_date", "currency", "auto_renew"}


# ---------------------------------------------------------------- helpers

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dec(value) -> Decimal:
    return Decimal(str(value))


def _date(value) -> Optional[date]:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _first_billing_date(start: date, trial_end: Optional[date]) -> date:
    return trial_end + timedelta(days=1) if trial_end else start


def price_line(quantity, unit_price, discount_percent=0, tax_rate=None) -> dict:
    """subtotal = qty * price; discount on subtotal; tax on (subtotal - discount)."""
    subtotal = money(_dec(quantity) * _dec(unit_price))
    discount = money(subtotal * _dec(discount_percent) / 100)
    taxable = subtotal - discount
    tax = calculate_tax(taxable, tax_rate)["tax_amount"] if tax_rate is not None else Decimal("0.00")
    return {
        "subtotal": subtotal,
        "discount_amount": discount,
        "tax_amount": tax,
        "line_total": taxable + tax,
    }


def compute_totals(lines: list[dict]) -> dict:
    zero = Decimal("0.00")
    return {
        "discount_amount": sum((_dec(l["discount_amount"]) for l in lines), zero),
        "tax_amount": sum((_dec(l["tax_amount"]) for l in lines), zero),
        "total_amount": sum((_dec(l["line_total"]) for l in lines), zero),
    }


def _plan_line(plan: dict, quantity) -> SubscriptionLineInput:
    return SubscriptionLineInput(
        description=plan.get("name") or "Subscription plan",
        quantity=quantity,
        unit_price=money(plan.get("price") or 0),
    )


def _is_plan_line(row: dict, plan: Optional[dict]) -> bool:
    return (plan is not None and row.get("product_id") is None
            and row.get("variant_id") is None and row.get("description") == plan.get("name"))


def _input_from_row(row: dict) -> SubscriptionLineInput:
    return SubscriptionLineInput(
        product_id=row.get("product_id"),
        variant_id=row.get("variant_id"),
        description=row["description"],
        quantity=_dec(row["quantity"]),
        unit_price=money(row["unit_price"]),
        discount_percent=_dec(row.get("discount_percent") or 0),
        tax_id=row.get("tax_id"),
        sequence=row.get("sequence"),
    )


# ---------------------------------------------------------------- reference validation

def _require_plan(repo: SubscriptionRepository, plan_id, quantity) -> dict:
    plan = repo.get_plan(plan_id)
    if not plan:
        raise ValidationError("Plan not found")
    if plan.get("is_active") is False:
        raise ValidationError("Plan is not active")
    min_qty = plan.get("min_quantity") or 1
    if _dec(quantity) < _dec(min_qty):
        raise ValidationError(f"Quantity must be at least the plan minimum of {min_qty}")
    return plan


def _require_active(lookup, ref_id, label: str) -> dict:
    row = lookup(ref_id)
    if not row:
        raise ValidationError(f"{label} not found")
    if row.get("is_active") is False:
        raise ValidationError(f"{label} is not active")
    return row


def _validate_optional_refs(repo: SubscriptionRepository, payment_terms_id, quotation_template_id):
    if payment_terms_id:
        _require_active(repo.get_payment_terms, payment_terms_id, "Payment terms")
    if quotation_template_id:
        _require_active(repo.get_quotation_template, quotation_template_id, "Quotation template")


def build_lines(repo: SubscriptionRepository, inputs: list[SubscriptionLineInput],
                snapshot_tax: bool = False) -> list[dict]:
    """Resolve product / variant / tax references and price each line.
    snapshot_tax adds tax_name / tax_rate (invoice lines store a copy)."""
    lines = []
    for index, item in enumerate(inputs):
        product_id, variant = item.product_id, None
        if item.variant_id:
            variant = _require_active(repo.get_variant, item.variant_id, "Variant")
            variant_product = variant.get("product_id")
            if product_id and variant_product and str(variant_product) != str(product_id):
                raise ValidationError("Variant does not belong to the given product")
            product_id = product_id or variant_product
        product = _require_active(repo.get_product, product_id, "Product") if product_id else None

        unit_price = item.unit_price
        if unit_price is None:
            unit_price = money(_dec(product.get("price") or 0) + _dec((variant or {}).get("extra_price") or 0))
        description = item.description
        if description is None:
            description = product.get("name") or "Product"
            if variant and variant.get("name"):
                description = f"{description} - {variant['name']}"

        tax_rate, tax_name = None, None
        if item.tax_id:
            tax = _require_active(repo.get_tax, item.tax_id, "Tax")
            tax_rate, tax_name = _dec(tax.get("rate") or 0), tax.get("name")

        line = {
            "product_id": product_id,
            "variant_id": item.variant_id,
            "sequence": item.sequence if item.sequence is not None else (index + 1) * 10,
            "description": description,
            "quantity": item.quantity,
            "unit_price": unit_price,
            "discount_percent": item.discount_percent,
            "tax_id": item.tax_id,
            **price_line(item.quantity, unit_price, item.discount_percent, tax_rate),
        }
        if snapshot_tax:
            line.update(tax_name=tax_name, tax_rate=tax_rate)
        lines.append(line)
    return lines


# ---------------------------------------------------------------- access

def own_customer_id(repo: SubscriptionRepository, user: CurrentUser) -> Optional[str]:
    customer = repo.get_customer_by_auth_user(user.id)
    return str(customer["id"]) if customer else None


def get_subscription(repo: SubscriptionRepository, subscription_id: UUID, user: CurrentUser) -> dict:
    """Customers only see their own subscriptions; others get 404 (no leak)."""
    sub = repo.get_subscription(subscription_id)
    if not sub:
        raise NotFoundError("Subscription not found")
    if user.role == Role.CUSTOMER and str(sub["customer_id"]) != own_customer_id(repo, user):
        raise NotFoundError("Subscription not found")
    return sub


def get_subscription_detail(repo, subscription_id, user) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    return {**sub, "lines": repo.list_lines(subscription_id)}


def list_subscriptions(repo, user, *, status=None, customer_id=None, plan_id=None,
                       limit=50, offset=0) -> list[dict]:
    if user.role == Role.CUSTOMER:
        customer_id = own_customer_id(repo, user)
        if customer_id is None:
            return []
    return repo.list_subscriptions(
        status=status.value if status else None,
        customer_id=customer_id, plan_id=plan_id, limit=limit, offset=offset,
    )


def list_history(repo, subscription_id, user) -> list[dict]:
    get_subscription(repo, subscription_id, user)
    return repo.list_history(subscription_id)


# ---------------------------------------------------------------- create / update

def create_subscription(repo: SubscriptionRepository, payload: SubscriptionCreate,
                        user: CurrentUser) -> dict:
    plan = _require_plan(repo, payload.plan_id, payload.quantity)
    _require_active(repo.get_customer, payload.customer_id, "Customer")
    _validate_optional_refs(repo, payload.payment_terms_id, payload.quotation_template_id)

    lines = build_lines(repo, payload.lines or [_plan_line(plan, payload.quantity)])
    sub = repo.insert_subscription({
        "customer_id": payload.customer_id,
        "plan_id": payload.plan_id,
        "quotation_template_id": payload.quotation_template_id,
        "payment_terms_id": payload.payment_terms_id,
        "status": S.DRAFT.value,
        "quantity": payload.quantity,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "trial_end_date": payload.trial_end_date,
        "next_billing_date": _first_billing_date(payload.start_date, payload.trial_end_date),
        "unit_price": money(plan.get("price") or 0),
        "currency": payload.currency,
        "auto_renew": payload.auto_renew,
        "notes": payload.notes,
        "created_by": user.id,
        **compute_totals(lines),
    })
    try:
        saved_lines = repo.insert_lines([{**l, "subscription_id": sub["id"]} for l in lines])
        repo.insert_history({
            "subscription_id": sub["id"], "from_status": None, "to_status": S.DRAFT.value,
            "changed_by": user.id, "metadata": {"action": "create"},
        })
    except Exception:
        # Supabase has no multi-statement transactions over REST; undo the header.
        repo.delete_subscription(sub["id"])
        raise
    return {**sub, "lines": saved_lines}


def update_subscription(repo: SubscriptionRepository, subscription_id: UUID,
                        payload: SubscriptionUpdate, user: CurrentUser) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    changes = payload.model_dump(exclude_unset=True, exclude={"lines"})
    lines_given = "lines" in payload.model_fields_set
    if not changes and not lines_given:
        raise ValidationError("No fields provided to update")

    if sub["status"] not in EDITABLE_STATUSES and (lines_given or set(changes) - ALWAYS_EDITABLE_FIELDS):
        raise ConflictError(
            f"Only notes and auto_renew can be changed once a subscription is {sub['status']}"
        )
    null_fields = sorted(f for f in NON_NULLABLE_FIELDS if f in changes and changes[f] is None)
    if null_fields or (lines_given and payload.lines is None):
        raise ValidationError(f"Fields cannot be null: {', '.join(null_fields or ['lines'])}")

    start = changes.get("start_date", _date(sub["start_date"]))
    end = changes["end_date"] if "end_date" in changes else _date(sub.get("end_date"))
    trial = changes["trial_end_date"] if "trial_end_date" in changes else _date(sub.get("trial_end_date"))
    try:
        _check_dates(start, end, trial)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    _validate_optional_refs(repo, changes.get("payment_terms_id"), changes.get("quotation_template_id"))

    new_lines = None
    if lines_given or "plan_id" in changes or "quantity" in changes:
        quantity = _dec(changes.get("quantity", sub["quantity"]))
        plan = _require_plan(repo, changes.get("plan_id", sub["plan_id"]), quantity)
        if lines_given:
            inputs = payload.lines or [_plan_line(plan, quantity)]
        else:
            # Re-price: the plan-derived line follows the new plan/quantity,
            # product lines keep their own quantity and price.
            old_plan = repo.get_plan(sub["plan_id"])
            inputs = [_plan_line(plan, quantity) if _is_plan_line(row, old_plan) else _input_from_row(row)
                      for row in repo.list_lines(subscription_id)] or [_plan_line(plan, quantity)]
        new_lines = build_lines(repo, inputs)
        changes.update(unit_price=money(plan.get("price") or 0), **compute_totals(new_lines))

    if {"start_date", "trial_end_date"} & set(changes):
        changes["next_billing_date"] = _first_billing_date(start, trial)
    changes["updated_at"] = _now()

    updated = repo.update_subscription(subscription_id, changes, expected_status=sub["status"])
    if not updated:
        raise ConflictError("Subscription was changed by someone else; reload and try again")
    if new_lines is not None:
        repo.delete_lines(subscription_id)
        repo.insert_lines([{**l, "subscription_id": subscription_id} for l in new_lines])
    return {**updated, "lines": repo.list_lines(subscription_id)}


# ---------------------------------------------------------------- lifecycle

def _transition(repo, sub: dict, to_status: S, user: CurrentUser, *, allowed_from: set,
                reason: Optional[str] = None, fields: Optional[dict] = None,
                metadata: Optional[dict] = None) -> dict:
    current = sub["status"]
    if current not in {s.value for s in allowed_from}:
        allowed = ", ".join(sorted(s.value for s in allowed_from))
        raise ConflictError(f"Cannot move a {current} subscription to {to_status.value} (allowed from: {allowed})")
    data = {"status": to_status.value, "updated_at": _now(), **(fields or {})}
    updated = repo.update_subscription(sub["id"], data, expected_status=current)
    if not updated:
        raise ConflictError("Subscription was changed by someone else; reload and try again")
    repo.insert_history({
        "subscription_id": sub["id"], "from_status": current, "to_status": to_status.value,
        "changed_by": user.id, "reason": reason, "metadata": metadata or {},
    })
    return updated


def _plan_flag(repo, sub: dict, flag: str) -> bool:
    plan = repo.get_plan(sub["plan_id"]) or {}
    return plan.get(flag) is not False      # missing column / NULL -> allowed


def send_quotation(repo, subscription_id, user, reason=None) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    number = sub.get("quotation_number") or "QUO-" + sub["subscription_number"].split("-", 1)[-1]
    return _transition(repo, sub, S.QUOTATION, user, allowed_from={S.DRAFT}, reason=reason,
                       fields={"quotation_number": number}, metadata={"action": "send_quotation"})


def confirm(repo, subscription_id, user, reason=None) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    # Customers may only accept a quotation that was sent to them.
    allowed = {S.QUOTATION} if user.role == Role.CUSTOMER else {S.DRAFT, S.QUOTATION}
    return _transition(repo, sub, S.CONFIRMED, user, allowed_from=allowed, reason=reason,
                       fields={"confirmed_at": _now()}, metadata={"action": "confirm"})


def activate(repo, subscription_id, user, reason=None) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    fields = {}
    if not sub.get("next_billing_date"):
        fields["next_billing_date"] = _first_billing_date(_date(sub["start_date"]),
                                                          _date(sub.get("trial_end_date")))
    return _transition(repo, sub, S.ACTIVE, user, allowed_from={S.CONFIRMED}, reason=reason,
                       fields=fields, metadata={"action": "activate"})


def pause(repo, subscription_id, user, reason=None) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    if sub["status"] == S.ACTIVE.value and not _plan_flag(repo, sub, "pausable"):
        raise ConflictError("This plan does not allow pausing")
    return _transition(repo, sub, S.PAUSED, user, allowed_from={S.ACTIVE}, reason=reason,
                       fields={"paused_at": _now(), "pause_reason": reason},
                       metadata={"action": "pause"})


def resume(repo, subscription_id, user, reason=None) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    return _transition(repo, sub, S.ACTIVE, user, allowed_from={S.PAUSED}, reason=reason,
                       fields={"paused_at": None, "pause_reason": None},
                       metadata={"action": "resume", "paused_at": sub.get("paused_at")})


def close(repo, subscription_id, user, reason=None, today: Optional[date] = None) -> dict:
    sub = get_subscription(repo, subscription_id, user)
    today = today or date.today()
    end = _date(sub.get("end_date"))
    running = {S.CONFIRMED.value, S.ACTIVE.value, S.PAUSED.value}
    if sub["status"] in running and end and today < end and not _plan_flag(repo, sub, "closable_early"):
        raise ConflictError("This plan does not allow closing before the end date")
    return _transition(repo, sub, S.CLOSED, user,
                       allowed_from={S.DRAFT, S.QUOTATION, S.CONFIRMED, S.ACTIVE, S.PAUSED},
                       reason=reason,
                       fields={"closed_at": _now(), "close_reason": reason, "next_billing_date": None},
                       metadata={"action": "close", "early": bool(end and today < end)})


def renew(repo, subscription_id, payload: RenewRequest, user) -> dict:
    """Extends end_date in place, by default by the current term length."""
    sub = get_subscription(repo, subscription_id, user)
    if sub["status"] != S.ACTIVE.value:
        raise ConflictError(f"Only active subscriptions can be renewed (status is {sub['status']})")
    if not _plan_flag(repo, sub, "renewable"):
        raise ConflictError("This plan does not allow renewal")
    start, end = _date(sub["start_date"]), _date(sub.get("end_date"))
    if end is None:
        raise ConflictError("Open-ended subscriptions do not need renewal")
    new_end = payload.new_end_date or end + (end - start)
    if new_end <= end:
        raise ValidationError("new_end_date must be after the current end_date")
    return _transition(repo, sub, S.ACTIVE, user, allowed_from={S.ACTIVE}, reason=payload.reason,
                       fields={"end_date": new_end},
                       metadata={"action": "renew", "previous_end_date": end.isoformat(),
                                 "new_end_date": new_end.isoformat()})

"""Pure discount functions. Dates must be datetime.date objects, not strings."""
from datetime import date
from decimal import Decimal

from app.services.tax_engine import money


def is_discount_eligible(discount: dict, quantity: int, subtotal, today: date = None):
    """
    discount keys: is_active, start_date, end_date, usage_limit, times_used,
                   min_quantity, min_purchase, type, value
    Returns (True/False, reason).
    """
    today = today or date.today()
    if not discount.get("is_active", True):
        return False, "Discount is inactive"
    start, end = discount.get("start_date"), discount.get("end_date")
    if start and today < start:
        return False, "Discount has not started yet"
    if end and today > end:
        return False, "Discount has expired"
    limit = discount.get("usage_limit")
    if limit is not None and discount.get("times_used", 0) >= limit:
        return False, "Usage limit reached"
    if quantity < (discount.get("min_quantity") or 0):
        return False, "Minimum quantity not met"
    if money(subtotal) < money(discount.get("min_purchase") or 0):
        return False, "Minimum purchase not met"
    return True, "Eligible"


def apply_discount(discount: dict, subtotal) -> Decimal:
    """Returns the discount AMOUNT, never more than the subtotal."""
    subtotal = money(subtotal)
    value = Decimal(str(discount["value"]))
    if discount["type"] == "percentage":
        amount = subtotal * value / 100
    elif discount["type"] == "fixed":
        amount = value
    else:
        raise ValueError("type must be 'percentage' or 'fixed'")
    return min(money(amount), subtotal)


def best_discount(discounts, quantity, subtotal, today: date = None):
    """Picks the eligible discount with the largest amount. Returns (discount, amount)."""
    best, best_amount = None, Decimal("0.00")
    for d in discounts:
        ok, _ = is_discount_eligible(d, quantity, subtotal, today)
        if ok:
            amt = apply_discount(d, subtotal)
            if amt > best_amount:
                best, best_amount = d, amt
    return best, best_amount

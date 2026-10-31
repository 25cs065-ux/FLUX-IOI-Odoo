from datetime import date
from decimal import Decimal
from app.services.discount_engine import is_discount_eligible, apply_discount

TODAY = date(2026, 11, 1)


def make(**kw):
    d = {"type": "percentage", "value": 10, "is_active": True,
         "start_date": date(2026, 1, 1), "end_date": date(2026, 12, 31),
         "usage_limit": 5, "times_used": 0, "min_quantity": 0, "min_purchase": 0}
    d.update(kw)
    return d


def test_percentage():
    assert apply_discount(make(), 500) == Decimal("50.00")


def test_fixed_capped_at_subtotal():
    assert apply_discount(make(type="fixed", value=1000), 300) == Decimal("300.00")


def test_expired():
    ok, why = is_discount_eligible(make(end_date=date(2026, 10, 1)), 1, 100, TODAY)
    assert not ok and "expired" in why


def test_not_started():
    ok, _ = is_discount_eligible(make(start_date=date(2026, 12, 1)), 1, 100, TODAY)
    assert not ok


def test_usage_limit_reached():
    ok, _ = is_discount_eligible(make(times_used=5), 1, 100, TODAY)
    assert not ok


def test_min_quantity_and_purchase():
    assert not is_discount_eligible(make(min_quantity=10), 3, 100, TODAY)[0]
    assert not is_discount_eligible(make(min_purchase=1000), 3, 100, TODAY)[0]
    assert is_discount_eligible(make(min_quantity=3, min_purchase=100), 3, 100, TODAY)[0]

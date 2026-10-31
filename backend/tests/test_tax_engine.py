from decimal import Decimal
from app.services.tax_engine import calculate_tax, summarize_taxes


def test_simple_tax():
    assert calculate_tax(1000, 18)["tax_amount"] == Decimal("180.00")


def test_rounding_half_up():
    # 33.33 * 18% = 5.9994 -> 6.00
    assert calculate_tax("33.33", 18)["tax_amount"] == Decimal("6.00")


def test_zero_rate():
    assert calculate_tax(500, 0)["tax_amount"] == Decimal("0.00")


def test_summary_groups_same_tax():
    lines = [
        {"amount": 1000, "taxes": [{"name": "GST", "rate": 18}]},
        {"amount": 500, "taxes": [{"name": "GST", "rate": 18}]},
    ]
    s = summarize_taxes(lines)
    assert s["subtotal"] == Decimal("1500.00")
    assert s["total_tax"] == Decimal("270.00")
    assert len(s["tax_breakdown"]) == 1
    assert s["grand_total"] == Decimal("1770.00")

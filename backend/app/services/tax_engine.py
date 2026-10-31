"""Pure tax functions. No database access, so they are easy to test."""
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def money(value) -> Decimal:
    """Round to 2 decimals (half up). Always build Decimals from str."""
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def calculate_tax(line_amount, tax_rate, name="Tax") -> dict:
    """One tax on one amount. tax_rate is a percent, e.g. 18 for 18%."""
    base = money(line_amount)
    rate = Decimal(str(tax_rate))
    if base < 0 or rate < 0:
        raise ValueError("amount and rate must be >= 0")
    return {
        "name": name,
        "rate": rate,
        "base": base,
        "tax_amount": money(base * rate / 100),
    }


def calculate_line_taxes(line_amount, taxes) -> list:
    """taxes = [{"name": "GST", "rate": 18}, ...] -> list of tax dicts."""
    return [calculate_tax(line_amount, t["rate"], t.get("name", "Tax")) for t in taxes]


def summarize_taxes(lines) -> dict:
    """
    lines = [{"amount": 1000, "taxes": [{"name": "GST", "rate": 18}]}, ...]
    Returns subtotal, tax breakdown grouped by (name, rate), total_tax, grand_total.
    """
    subtotal = Decimal("0.00")
    grouped = {}
    for line in lines:
        subtotal += money(line["amount"])
        for t in calculate_line_taxes(line["amount"], line.get("taxes", [])):
            key = (t["name"], t["rate"])
            grouped[key] = grouped.get(key, Decimal("0.00")) + t["tax_amount"]
    breakdown = [
        {"name": n, "rate": r, "tax_amount": a} for (n, r), a in grouped.items()
    ]
    total_tax = sum((b["tax_amount"] for b in breakdown), Decimal("0.00"))
    return {
        "subtotal": subtotal,
        "tax_breakdown": breakdown,
        "total_tax": total_tax,
        "grand_total": subtotal + total_tax,
    }

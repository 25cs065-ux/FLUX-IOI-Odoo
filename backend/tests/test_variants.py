import pytest
from app.routers.variants import calculate_final_price
from app.schemas.variant import VariantCreate
from pydantic import ValidationError

def test_price_calculation():
    # Base: 100, Extra: 560 -> Final: 660
    assert calculate_final_price(100.0, 560.0) == 660.0
    assert calculate_final_price(0.0, 50.0) == 50.0
    assert calculate_final_price(49.99, 10.01) == 60.0

def test_negative_extra_price_validation():
    with pytest.raises(ValidationError):
        VariantCreate(
            product_id="prod_123",
            name="Invalid Variant",
            extra_price=-10.0
        )

def test_valid_extra_price_zero():
    variant = VariantCreate(
        product_id="prod_123",
        name="Standard Variant",
        extra_price=0.0
    )
    assert variant.extra_price == 0.0

import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from app.schemas.variant import VariantCreate
from app.routers.variants import calculate_final_price

def test_valid_variant_creation():
    variant = VariantCreate(
        product_id="a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
        name="16GB RAM Upgrade",
        sku_suffix="16GB",
        extra_price=50.0
    )
    assert variant.name == "16GB RAM Upgrade"
    assert variant.extra_price == 50.0

def test_negative_extra_price_validation_error():
    with pytest.raises(ValidationError):
        VariantCreate(
            product_id="a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
            name="Invalid Price",
            extra_price=-10.0
        )

def test_calculate_final_price_success():
    assert calculate_final_price(100.0, 25.5) == 125.5

def test_calculate_final_price_negative_base_fails():
    with pytest.raises(HTTPException) as exc:
        calculate_final_price(-10.0, 5.0)
    assert exc.value.status_code == 422

def test_calculate_final_price_negative_extra_fails():
    with pytest.raises(HTTPException) as exc:
        calculate_final_price(100.0, -5.0)
    assert exc.value.status_code == 422

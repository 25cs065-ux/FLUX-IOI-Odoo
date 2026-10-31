import pytest
from datetime import datetime, timedelta, timezone
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.discount import DiscountCreate, DiscountType, AppliesTo
from app.routers.discounts import router as discounts_router

test_app = FastAPI()
test_app.include_router(discounts_router)
client = TestClient(test_app)

def test_valid_percentage_discount():
    discount = DiscountCreate(
        code="SAVE25",
        discount_type=DiscountType.PERCENTAGE,
        value=25.0,
        applies_to=AppliesTo.SUBSCRIPTION
    )
    assert discount.value == 25.0
    assert discount.discount_type == DiscountType.PERCENTAGE

def test_percentage_over_100_fails():
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="INVALID150",
            discount_type=DiscountType.PERCENTAGE,
            value=150.0,
            applies_to=AppliesTo.PRODUCT
        )

def test_negative_value_fails():
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="NEGATIVE10",
            discount_type=DiscountType.FIXED,
            value=-10.0,
            applies_to=AppliesTo.PRODUCT
        )

def test_negative_min_purchase_fails():
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="BADPURCHASE",
            discount_type=DiscountType.FIXED,
            value=10.0,
            min_purchase=-5.0,
            applies_to=AppliesTo.PRODUCT
        )

def test_zero_min_quantity_fails():
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="BADQTY",
            discount_type=DiscountType.FIXED,
            value=10.0,
            min_quantity=0,
            applies_to=AppliesTo.PRODUCT
        )

def test_end_date_before_start_date_fails():
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="PASTEND",
            discount_type=DiscountType.FIXED,
            value=10.0,
            applies_to=AppliesTo.PRODUCT,
            start_date=now,
            end_date=now - timedelta(days=2)
        )

def test_admin_enforcement_blocks_non_admin_listing():
    res = client.get("/discounts", headers={"X-User-Role": "customer"})
    assert res.status_code == 403

def test_admin_enforcement_blocks_missing_role():
    res = client.get("/discounts")
    assert res.status_code == 403

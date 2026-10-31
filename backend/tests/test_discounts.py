import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.discount import DiscountCreate, DiscountType, AppliesTo
from app.routers.discounts import router as discounts_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(discounts_router)
client = TestClient(test_app)

def test_valid_discount_creation():
    now = datetime.now(timezone.utc)
    d = DiscountCreate(
        code="SAVE20",
        discount_type=DiscountType.PERCENTAGE,
        value=20.0,
        applies_to=AppliesTo.PRODUCT,
        start_date=now,
        end_date=now + timedelta(days=10)
    )
    assert d.code == "SAVE20"
    assert d.value == 20.0
    assert d.applies_to == AppliesTo.PRODUCT

def test_negative_discount_value_fails():
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="INVALID",
            discount_type=DiscountType.PERCENTAGE,
            value=-5.0,
            applies_to=AppliesTo.PRODUCT,
            start_date=now,
            end_date=now + timedelta(days=10)
        )

def test_over_100_percent_fails():
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="OVER100",
            discount_type=DiscountType.PERCENTAGE,
            value=105.0,
            applies_to=AppliesTo.PRODUCT,
            start_date=now,
            end_date=now + timedelta(days=10)
        )

def test_end_date_before_start_date_fails():
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="DATEFAIL",
            discount_type=DiscountType.PERCENTAGE,
            value=10.0,
            applies_to=AppliesTo.PRODUCT,
            start_date=now,
            end_date=now - timedelta(days=1)
        )

def test_admin_enforcement_blocks_unauthenticated():
    now = datetime.now(timezone.utc)
    payload = {
        "code": "PROMO10",
        "discount_type": "percentage",
        "value": 10.0,
        "applies_to": "product",
        "start_date": now.isoformat(),
        "end_date": (now + timedelta(days=5)).isoformat()
    }
    res = client.post("/discounts/", json=payload)
    assert res.status_code == 401

def test_admin_enforcement_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "cust@test.com", "role": "customer"}
    try:
        now = datetime.now(timezone.utc)
        payload = {
            "code": "PROMO10",
            "discount_type": "percentage",
            "value": 10.0,
            "applies_to": "product",
            "start_date": now.isoformat(),
            "end_date": (now + timedelta(days=5)).isoformat()
        }
        res = client.post("/discounts/", json=payload)
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.discounts.supabase")
def test_admin_enforcement_permits_admin(mock_supabase):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "a1", "email": "admin@test.com", "role": "admin"}
    
    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value.data = [{
        "id": "00000000-0000-0000-0000-000000000000",
        "code": "ADMINPROMO",
        "discount_type": "percentage",
        "value": 15.0,
        "min_purchase": 0.0,
        "min_quantity": 1,
        "applies_to": "product",
        "start_date": "2026-10-31T00:00:00Z",
        "end_date": "2026-11-10T00:00:00Z",
        "is_active": True,
        "usage_count": 0,
        "created_at": "2026-10-31T00:00:00Z"
    }]
    mock_supabase.table.return_value = mock_table

    try:
        now = datetime.now(timezone.utc)
        payload = {
            "code": "ADMINPROMO",
            "discount_type": "percentage",
            "value": 15.0,
            "applies_to": "product",
            "start_date": now.isoformat(),
            "end_date": (now + timedelta(days=10)).isoformat()
        }
        res = client.post("/discounts/", json=payload)
        assert res.status_code in (200, 201)
    finally:
        test_app.dependency_overrides.clear()

import pytest
from datetime import date, timedelta
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.discount import DiscountCreate
from app.routers.discounts import router as discounts_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(discounts_router)
client = TestClient(test_app)

def test_valid_discount_creation():
    today = date.today()
    d = DiscountCreate(
        code="SAVE20",
        discount_percent=20.0,
        valid_from=today,
        valid_until=today + timedelta(days=10)
    )
    assert d.code == "SAVE20"
    assert d.discount_percent == 20.0

def test_negative_discount_percent_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="INVALID",
            discount_percent=-5.0,
            valid_from=today,
            valid_until=today + timedelta(days=10)
        )

def test_over_100_percent_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="OVER100",
            discount_percent=105.0,
            valid_from=today,
            valid_until=today + timedelta(days=10)
        )

def test_valid_until_before_valid_from_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        DiscountCreate(
            code="DATEFAIL",
            discount_percent=10.0,
            valid_from=today,
            valid_until=today - timedelta(days=1)
        )

def test_admin_enforcement_blocks_unauthenticated():
    today = date.today()
    payload = {
        "code": "PROMO10",
        "discount_percent": 10.0,
        "valid_from": str(today),
        "valid_until": str(today + timedelta(days=5))
    }
    res = client.post("/discounts/", json=payload)
    assert res.status_code == 401

def test_admin_enforcement_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "cust@test.com", "role": "customer"}
    try:
        today = date.today()
        payload = {
            "code": "PROMO10",
            "discount_percent": 10.0,
            "valid_from": str(today),
            "valid_until": str(today + timedelta(days=5))
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
        "discount_percent": 15.0,
        "valid_from": "2026-10-31",
        "valid_until": "2026-11-10"
    }]
    mock_supabase.table.return_value = mock_table

    try:
        today = date.today()
        payload = {
            "code": "ADMINPROMO",
            "discount_percent": 15.0,
            "valid_from": str(today),
            "valid_until": str(today + timedelta(days=10))
        }
        res = client.post("/discounts/", json=payload)
        assert res.status_code in (200, 201)
    finally:
        test_app.dependency_overrides.clear()

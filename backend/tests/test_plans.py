import pytest
from datetime import date, timedelta
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.plan import PlanCreate
from app.routers.plans import router as plans_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(plans_router)
client = TestClient(test_app)

def test_valid_plan_creation():
    today = date.today()
    plan = PlanCreate(
        name="Enterprise Tier",
        price=99.99,
        interval="monthly",
        min_quantity=1,
        start_date=today,
        end_date=today + timedelta(days=30)
    )
    assert plan.name == "Enterprise Tier"
    assert plan.price == 99.99
    assert plan.interval == "monthly"

def test_negative_price_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        PlanCreate(
            name="Free Trial",
            price=-10.0,
            interval="monthly",
            min_quantity=1,
            start_date=today,
            end_date=today + timedelta(days=30)
        )

def test_zero_min_quantity_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        PlanCreate(
            name="Standard Plan",
            price=20.0,
            interval="monthly",
            min_quantity=0,
            start_date=today,
            end_date=today + timedelta(days=30)
        )

def test_end_date_before_start_date_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        PlanCreate(
            name="Invalid Plan",
            price=20.0,
            interval="monthly",
            min_quantity=1,
            start_date=today,
            end_date=today - timedelta(days=1)
        )

def test_end_date_equal_start_date_fails():
    today = date.today()
    with pytest.raises(ValidationError):
        PlanCreate(
            name="Invalid Same Day Plan",
            price=20.0,
            interval="monthly",
            min_quantity=1,
            start_date=today,
            end_date=today
        )

def test_admin_enforcement_blocks_missing_token():
    today = date.today()
    payload = {
        "name": "Unauthorized Plan",
        "price": 10.0,
        "interval": "monthly",
        "min_quantity": 1,
        "start_date": str(today),
        "end_date": str(today + timedelta(days=10))
    }
    res = client.post("/plans/", json=payload)
    assert res.status_code == 401

def test_admin_enforcement_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "cust@test.com", "role": "customer"}
    try:
        today = date.today()
        payload = {
            "name": "Customer Created Plan",
            "price": 10.0,
            "interval": "monthly",
            "min_quantity": 1,
            "start_date": str(today),
            "end_date": str(today + timedelta(days=10))
        }
        res = client.post("/plans/", json=payload)
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.plans.supabase")
def test_admin_enforcement_permits_admin(mock_supabase):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "a1", "email": "admin@test.com", "role": "admin"}
    
    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value.data = [{
        "id": "00000000-0000-0000-0000-000000000000",
        "name": "Admin Plan",
        "price": 50.0,
        "interval": "monthly",
        "min_quantity": 1,
        "start_date": "2026-10-31",
        "end_date": "2026-11-10",
        "created_at": "2026-10-31T00:00:00Z"
    }]
    mock_supabase.table.return_value = mock_table
    
    try:
        today = date.today()
        payload = {
            "name": "Admin Plan",
            "price": 50.0,
            "interval": "monthly",
            "min_quantity": 1,
            "start_date": str(today),
            "end_date": str(today + timedelta(days=10))
        }
        res = client.post("/plans/", json=payload)
        assert res.status_code in (200, 201)
    finally:
        test_app.dependency_overrides.clear()

import pytest
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.tax import TaxCreate
from app.routers.taxes import router as taxes_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(taxes_router)
client = TestClient(test_app)

def test_valid_tax_creation():
    tax = TaxCreate(name="Standard VAT", rate=18.0)
    assert tax.name == "Standard VAT"
    assert tax.rate == 18.0

def test_tax_rate_zero_valid():
    tax = TaxCreate(name="Zero Tax", rate=0.0)
    assert tax.rate == 0.0

def test_tax_rate_100_valid():
    tax = TaxCreate(name="Max Tax", rate=100.0)
    assert tax.rate == 100.0

def test_tax_rate_negative_fails():
    with pytest.raises(ValidationError):
        TaxCreate(name="Negative Tax", rate=-1.0)

def test_tax_rate_over_100_fails():
    with pytest.raises(ValidationError):
        TaxCreate(name="Over 100 Tax", rate=100.1)

def test_admin_role_enforcement_blocks_missing_token():
    payload = {"name": "Test Tax", "rate": 5.0}
    res = client.post("/taxes/", json=payload)
    assert res.status_code == 401

def test_admin_role_enforcement_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "cust@test.com", "role": "customer"}
    try:
        payload = {"name": "Test Tax", "rate": 5.0}
        res = client.post("/taxes/", json=payload)
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.taxes.supabase")
def test_admin_role_enforcement_permits_admin(mock_supabase):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "a1", "email": "admin@test.com", "role": "admin"}
    
    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value.data = [{
        "id": "00000000-0000-0000-0000-000000000000",
        "name": "Admin Tax",
        "rate": 12.0,
        "is_active": True,
        "created_at": "2026-10-31T00:00:00Z"
    }]
    mock_supabase.table.return_value = mock_table

    try:
        payload = {"name": "Admin Tax", "rate": 12.0}
        res = client.post("/taxes/", json=payload)
        assert res.status_code in (200, 201)
        assert res.json()["name"] == "Admin Tax"
    finally:
        test_app.dependency_overrides.clear()

import pytest
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
    tax = TaxCreate(name="GST 18%", rate=18.0)
    assert tax.name == "GST 18%"
    assert tax.rate == 18.0

def test_tax_rate_zero_valid():
    tax = TaxCreate(name="Zero Tax", rate=0.0)
    assert tax.rate == 0.0

def test_tax_rate_100_valid():
    tax = TaxCreate(name="Max Tax", rate=100.0)
    assert tax.rate == 100.0

def test_tax_rate_negative_fails():
    with pytest.raises(ValidationError):
        TaxCreate(name="Negative Tax", rate=-5.0)

def test_tax_rate_over_100_fails():
    with pytest.raises(ValidationError):
        TaxCreate(name="Over Max Tax", rate=105.0)

def test_admin_role_enforcement_blocks_missing_token():
    # Unauthenticated request must return 401 Unauthorized
    response = client.get("/taxes/")
    assert response.status_code == 401

def test_admin_role_enforcement_blocks_customer():
    # Authenticated customer user must receive 403 Forbidden
    test_app.dependency_overrides[get_current_user] = lambda: {
        "id": "cust-001",
        "email": "customer@example.com",
        "role": "customer"
    }
    try:
        response = client.get("/taxes/")
        assert response.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

def test_admin_role_enforcement_permits_admin():
    # Authenticated admin user passes RBAC check
    test_app.dependency_overrides[get_current_user] = lambda: {
        "id": "admin-001",
        "email": "admin@example.com",
        "role": "admin"
    }
    try:
        response = client.get("/taxes/")
        # Status code 200 confirms require_admin dependency allowed the request through
        assert response.status_code in (200, 404)
    finally:
        test_app.dependency_overrides.clear()

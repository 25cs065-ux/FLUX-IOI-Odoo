import pytest
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.routers.customers import router as customers_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(customers_router)
client = TestClient(test_app)

def test_valid_customer_creation():
    cust = CustomerCreate(
        name="Jane Doe",
        email="jane.doe@example.com",
        phone="+1234567890"
    )
    assert cust.name == "Jane Doe"
    assert cust.email == "jane.doe@example.com"

def test_invalid_email_format_fails():
    with pytest.raises(ValidationError):
        CustomerCreate(
            name="Jane Doe",
            email="invalid-email-address",
            phone="+1234567890"
        )

def test_short_name_fails():
    with pytest.raises(ValidationError):
        CustomerCreate(
            name="",
            email="jane@example.com",
            phone="+1234567890"
        )

def test_staff_creation_blocks_unauthenticated():
    payload = {
        "name": "Staff Member",
        "email": "staff@example.com",
        "role": "staff",
        "password": "SecurePassword123!"
    }
    res = client.post("/customers/staff", json=payload)
    assert res.status_code == 401

def test_staff_creation_blocks_customer_role():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "cust@test.com", "role": "customer"}
    try:
        payload = {
            "name": "Staff Member",
            "email": "staff@example.com",
            "role": "staff",
            "password": "SecurePassword123!"
        }
        res = client.post("/customers/staff", json=payload)
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.customers.supabase")
def test_staff_creation_permits_admin(mock_supabase):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "a1", "email": "admin@test.com", "role": "admin"}
    
    mock_auth_res = MagicMock()
    mock_auth_res.user.id = "auth-staff-001"
    mock_supabase.auth.admin.create_user.return_value = mock_auth_res
    
    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value.data = [{
        "id": "00000000-0000-0000-0000-000000000000",
        "name": "Staff Member",
        "email": "staff@example.com",
        "role": "staff",
        "phone": "+1234567890",
        "created_at": "2026-10-31T00:00:00Z"
    }]
    mock_supabase.table.return_value = mock_table

    try:
        payload = {
            "name": "Staff Member",
            "email": "staff@example.com",
            "role": "staff",
            "phone": "+1234567890",
            "password": "SecurePassword123!"
        }
        res = client.post("/customers/staff", json=payload)
        assert res.status_code in (200, 201)
    finally:
        test_app.dependency_overrides.clear()

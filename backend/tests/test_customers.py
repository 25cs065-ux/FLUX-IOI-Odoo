import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.customer import CustomerCreate, StaffCreate, UserRole
from app.routers.customers import router as customers_router

test_app = FastAPI()
test_app.include_router(customers_router)
client = TestClient(test_app)

def test_valid_customer_creation():
    cust = CustomerCreate(name="John Doe", email="john@example.com")
    assert cust.name == "John Doe"
    assert cust.email == "john@example.com"

def test_valid_staff_password_greater_than_8_chars():
    staff = StaffCreate(name="Staff One", email="staff1@example.com", password="password123")
    assert staff.name == "Staff One"

def test_staff_password_exact_8_chars_fails():
    with pytest.raises(ValidationError):
        StaffCreate(name="Staff Bad", email="bad@example.com", password="12345678")

def test_staff_password_less_than_8_chars_fails():
    with pytest.raises(ValidationError):
        StaffCreate(name="Staff Short", email="short@example.com", password="short")

def test_invalid_email_format_fails():
    with pytest.raises(ValidationError):
        CustomerCreate(name="Invalid Email", email="not-an-email")

def test_staff_creation_blocks_non_admin():
    res = client.post("/customers/staff", json={"name": "Test", "email": "test@test.com", "password": "securepassword123"}, headers={"X-User-Role": "customer"})
    assert res.status_code == 403

def test_staff_creation_blocks_missing_role():
    res = client.post("/customers/staff", json={"name": "Test", "email": "test@test.com", "password": "securepassword123"})
    assert res.status_code == 403

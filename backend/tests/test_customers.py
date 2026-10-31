import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.routers.customers import router as customers_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(customers_router)
client = TestClient(test_app)

DUMMY_ID = "00000000-0000-0000-0000-000000000000"

def test_unauthenticated_requests_blocked():
    assert client.get("/customers/").status_code == 401
    assert client.get(f"/customers/{DUMMY_ID}").status_code == 401
    assert client.post("/customers/", json={"name": "Alice", "email": "alice@test.com"}).status_code == 401
    assert client.patch(f"/customers/{DUMMY_ID}", json={"name": "Alice Updated"}).status_code == 401

@patch("app.routers.customers.supabase")
def test_admin_create_customer_with_custom_auth_id(mock_sb):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "admin-1", "email": "admin@test.com", "role": "admin"}
    mock_table = MagicMock()
    mock_table.select.return_value.or_.return_value.execute.return_value.data = []
    created_record = {
        "id": DUMMY_ID,
        "name": "Corporate Client",
        "email": "client@corp.com",
        "auth_user_id": "target-auth-uuid",
        "role": "customer",
        "is_active": True,
        "created_at": "2026-10-31T00:00:00Z"
    }
    mock_table.insert.return_value.execute.return_value.data = [created_record]
    mock_sb.table.return_value = mock_table

    try:
        payload = {
            "name": "Corporate Client",
            "email": "client@corp.com",
            "auth_user_id": "target-auth-uuid",
            "role": "customer"
        }
        res = client.post("/customers/", json=payload)
        assert res.status_code == 201
        assert res.json()["auth_user_id"] == "target-auth-uuid"
        called_data = mock_table.insert.call_args[0][0]
        assert called_data["auth_user_id"] == "target-auth-uuid"
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.customers.supabase")
def test_staff_create_customer_without_explicit_auth_id(mock_sb):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "staff-1", "email": "staff@test.com", "role": "staff"}
    mock_table = MagicMock()
    mock_table.select.return_value.or_.return_value.execute.return_value.data = []
    created_record = {
        "id": DUMMY_ID,
        "name": "Walk-in Customer",
        "email": "walkin@test.com",
        "auth_user_id": "staff-1",
        "role": "customer",
        "is_active": True,
        "created_at": "2026-10-31T00:00:00Z"
    }
    mock_table.insert.return_value.execute.return_value.data = [created_record]
    mock_sb.table.return_value = mock_table

    try:
        payload = {
            "name": "Walk-in Customer",
            "email": "walkin@test.com"
        }
        res = client.post("/customers/", json=payload)
        assert res.status_code == 201
        assert res.json()["name"] == "Walk-in Customer"
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.customers.supabase")
def test_duplicate_customer_creation_fails(mock_sb):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "user-A", "email": "a@test.com", "role": "customer"}
    mock_sb.table.return_value.select.return_value.or_.return_value.execute.return_value.data = [{"id": DUMMY_ID}]
    try:
        res = client.post("/customers/", json={"name": "Alice", "email": "a@test.com"})
        assert res.status_code == 409
        assert "already exists" in res.json()["detail"]
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.customers.supabase")
def test_customer_cannot_deactivate_self(mock_sb):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "user-A", "email": "a@test.com", "role": "customer"}
    mock_record = {
        "id": DUMMY_ID,
        "name": "Alice",
        "email": "a@test.com",
        "auth_user_id": "user-A",
        "is_active": True,
        "role": "customer"
    }
    mock_table = MagicMock()
    mock_table.select.return_value.eq.return_value.execute.return_value.data = [mock_record]
    mock_table.update.return_value.eq.return_value.execute.return_value.data = [mock_record]
    mock_sb.table.return_value = mock_table

    try:
        res = client.patch(f"/customers/{DUMMY_ID}", json={"is_active": False})
        assert res.status_code == 200
        called_payload = mock_table.update.call_args[0][0]
        assert "is_active" not in called_payload
    finally:
        test_app.dependency_overrides.clear()

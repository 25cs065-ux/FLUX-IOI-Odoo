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

def test_customer_cannot_view_other_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "user-A", "email": "a@test.com", "role": "customer"}
    with patch("app.routers.customers.supabase") as mock_sb:
        mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": DUMMY_ID,
            "name": "Bob",
            "email": "bob@test.com",
            "auth_user_id": "user-B",
            "role": "customer"
        }]
        res = client.get(f"/customers/{DUMMY_ID}")
        assert res.status_code == 403
    test_app.dependency_overrides.clear()

@patch("app.routers.customers.supabase")
def test_admin_can_view_any_customer(mock_sb):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "admin-1", "email": "admin@test.com", "role": "admin"}
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
        "id": DUMMY_ID,
        "name": "Bob",
        "email": "bob@test.com",
        "auth_user_id": "user-B",
        "role": "customer"
    }]
    try:
        res = client.get(f"/customers/{DUMMY_ID}")
        assert res.status_code == 200
        assert res.json()["name"] == "Bob"
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.customers.supabase")
def test_list_customers_with_pagination_and_search(mock_sb):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "admin-1", "email": "admin@test.com", "role": "admin"}
    mock_query = MagicMock()
    mock_sb.table.return_value.select.return_value = mock_query
    mock_query.or_.return_value = mock_query
    mock_query.order.return_value = mock_query
    mock_query.range.return_value.execute.return_value.data = []

    try:
        res = client.get("/customers/?search=test%2Cevil()&limit=10&offset=5")
        assert res.status_code == 200
        # Verify sanitization stripped commas and parentheses
        mock_query.or_.assert_called_once_with("name.ilike.%testevil%,email.ilike.%testevil%")
        mock_query.range.assert_called_once_with(5, 14)
    finally:
        test_app.dependency_overrides.clear()

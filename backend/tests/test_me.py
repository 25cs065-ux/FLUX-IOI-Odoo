import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.current_user import CurrentUser, Role, get_current_user
from app.main import app
from app.repositories.subscription_repository import get_subscription_repository
from subscription_fakes import FakeSubscriptionRepository

CUSTOMER_USER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER, email="c@example.com")
STAFF = CurrentUser(id=uuid.uuid4(), role=Role.STAFF, email="s@example.com")


@pytest.fixture
def client():
    repo = FakeSubscriptionRepository()
    repo.customer = repo.add(repo.customers, name="Initech Ltd", auth_user_id=str(CUSTOMER_USER.id))
    state = {"user": CUSTOMER_USER}
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    class Client(TestClient):
        def as_user(self, user):
            state["user"] = user
            return self

    yield Client(app), repo
    app.dependency_overrides.clear()


def test_me_returns_customer_role_name_and_record(client):
    c, repo = client
    res = c.get("/me")
    assert res.status_code == 200
    assert res.json() == {"id": str(CUSTOMER_USER.id), "email": "c@example.com", "role": "customer",
                          "name": "Initech Ltd", "customer_id": repo.customer["id"]}


def test_me_for_staff_without_customer_row(client):
    c, _ = client
    body = c.as_user(STAFF).get("/me").json()
    assert body["role"] == "staff" and body["name"] is None and body["customer_id"] is None


def test_me_requires_a_token():
    app.dependency_overrides.clear()
    assert TestClient(app).get("/me").status_code == 401

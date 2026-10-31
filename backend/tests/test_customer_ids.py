"""Malformed customer ids must be a 422 validation error, not a 500 from Postgres."""
import uuid

import pytest
from fastapi.testclient import TestClient

import app.routers.customers as customers_router
from app.core.auth import get_current_user
from app.main import app


class FailingIfQueried:
    def table(self, name):
        raise AssertionError("the database must not be queried with a malformed id")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(customers_router, "supabase", FailingIfQueried())
    app.dependency_overrides[get_current_user] = lambda: {"id": str(uuid.uuid4()), "role": "admin", "email": "a@x.io"}
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("bad_id", ["undefined", "not-a-uuid", "123"])
def test_get_customer_with_malformed_id_is_422(client, bad_id):
    assert client.get(f"/customers/{bad_id}").status_code == 422


def test_patch_customer_with_malformed_id_is_422(client):
    assert client.patch("/customers/undefined", json={"name": "x"}).status_code == 422

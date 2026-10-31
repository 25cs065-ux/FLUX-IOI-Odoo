"""The adapter around the team's shared Supabase Auth dependency
(app.core.auth.get_current_user), exercised with a stand-in module."""
import sys
import types
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.repositories.subscription_repository import get_subscription_repository
from subscription_fakes import FakeSubscriptionRepository

USER_ID = str(uuid.uuid4())


def install_shared_auth(monkeypatch, verify):
    module = types.ModuleType("app.core.auth")
    module.get_current_user = verify
    monkeypatch.setitem(sys.modules, "app.core.auth", module)


@pytest.fixture
def client():
    app.dependency_overrides[get_subscription_repository] = FakeSubscriptionRepository
    yield TestClient(app)
    app.dependency_overrides.clear()


def bearer(token="token-123"):
    return {"Authorization": f"Bearer {token}"}


def test_missing_token_is_401_without_calling_shared_auth(client, monkeypatch):
    calls = []
    install_shared_auth(monkeypatch, lambda creds: calls.append(creds))
    res = client.get("/subscriptions")
    assert res.status_code == 401 and res.headers["www-authenticate"] == "Bearer"
    assert calls == []


def test_shared_module_absent_fails_closed(client, monkeypatch):
    monkeypatch.setitem(sys.modules, "app.core.auth", None)     # import raises ModuleNotFoundError
    res = client.get("/subscriptions", headers=bearer())
    assert res.status_code == 503 and "not configured" in res.json()["detail"]


def test_shared_module_misconfigured_fails_closed(client, monkeypatch):
    class Exploding(types.ModuleType):
        def __getattr__(self, name):
            raise RuntimeError("Critical startup configuration failure: SUPABASE_SERVICE_KEY missing")

    monkeypatch.setitem(sys.modules, "app.core.auth", Exploding("app.core.auth"))
    res = client.get("/subscriptions", headers=bearer())
    assert res.status_code == 503
    assert "SUPABASE" not in res.text                           # no config details leaked


def test_token_is_passed_to_shared_auth_and_role_is_applied(client, monkeypatch):
    seen = {}

    def verify(credentials):
        seen["token"] = credentials.credentials
        return {"id": USER_ID, "email": "staff@example.test", "role": "staff"}

    install_shared_auth(monkeypatch, verify)
    res = client.get("/subscriptions", headers=bearer("abc.def.ghi"))
    assert res.status_code == 200 and res.json() == []
    assert seen["token"] == "abc.def.ghi"


def test_rejected_token_keeps_shared_401(client, monkeypatch):
    def verify(credentials):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    install_shared_auth(monkeypatch, verify)
    res = client.get("/subscriptions", headers=bearer())
    assert res.status_code == 401 and res.json()["detail"] == "Invalid or expired token"


@pytest.mark.parametrize("verified,code", [
    ({"id": USER_ID, "role": "superuser"}, 403),
    ({"id": USER_ID, "role": None}, 403),
    ({"id": "not-a-uuid", "role": "admin"}, 401),
    ({"role": "admin"}, 401),
])
def test_unexpected_identity_is_rejected(client, monkeypatch, verified, code):
    install_shared_auth(monkeypatch, lambda creds: verified)
    assert client.get("/subscriptions", headers=bearer()).status_code == code


def test_customer_role_cannot_create(client, monkeypatch):
    install_shared_auth(monkeypatch, lambda creds: {"id": USER_ID, "role": "customer"})
    assert client.post("/subscriptions", json={}, headers=bearer()).status_code == 403


def test_x_user_role_header_is_ignored(client, monkeypatch):
    install_shared_auth(monkeypatch, lambda creds: {"id": USER_ID, "role": "customer"})
    res = client.post("/subscriptions", json={}, headers={**bearer(), "X-User-Role": "admin"})
    assert res.status_code == 403

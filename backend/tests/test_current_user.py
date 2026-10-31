"""Security tests for Supabase access-token verification and role resolution.

Tokens are really signed (HS256 secret and an ES256 key pair generated here)
and really verified by PyJWT. Only the JWKS download and the customers table
are replaced by in-memory stand-ins.
"""
import hashlib
import hmac
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.core.current_user import AuthBackend, get_auth_backend
from app.core.supabase_jwt import AuthSettings, SupabaseTokenVerifier
from app.main import app
from app.repositories.subscription_repository import get_subscription_repository
from subscription_fakes import FakeSubscriptionRepository, seed_catalog
from test_subscriptions import TODAY

SUPABASE_URL = "https://unit-test-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
SECRET = "unit-test-secret-" + "x" * 64
EC_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_EC_KEY = ec.generate_private_key(ec.SECP256R1())
KID = "test-key-1"


class FakeJwkClient:
    """Stands in for PyJWKClient: serves our public key for kid test-key-1."""

    def __init__(self, reachable=True):
        self.reachable = reachable

    def get_signing_key_from_jwt(self, token):
        if not self.reachable:
            raise jwt.PyJWKClientConnectionError("network down")
        if jwt.get_unverified_header(token).get("kid") != KID:
            raise jwt.PyJWKClientError("Unable to find a signing key that matches")
        return type("SigningKey", (), {"key": EC_KEY.public_key()})()


def claims(**overrides):
    now = int(time.time())
    base = {"sub": str(uuid.uuid4()), "aud": "authenticated", "iss": ISSUER, "role": "authenticated",
            "exp": now + 3600, "iat": now, "email": "user@example.test"}
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def hs256(**overrides):
    return jwt.encode(claims(**overrides), SECRET, algorithm="HS256")


def es256(key=EC_KEY, kid=KID, **overrides):
    return jwt.encode(claims(**overrides), key, algorithm="ES256", headers={"kid": kid})


class Env:
    def __init__(self):
        self.customers = {}          # auth user id -> {"role", "is_active"}
        self.jwk_client = FakeJwkClient()
        self.secret = SECRET
        self.lookup_error = None

    def backend(self):
        settings = AuthSettings(supabase_url=SUPABASE_URL, jwt_secret=self.secret)
        def lookup(user_id):
            if self.lookup_error:
                raise self.lookup_error
            return self.customers.get(str(user_id))
        return AuthBackend(SupabaseTokenVerifier(settings, jwk_client=self.jwk_client), lookup)


@pytest.fixture
def env():
    return Env()


@pytest.fixture
def repo():
    return FakeSubscriptionRepository()


@pytest.fixture
def client(env, repo):
    app.dependency_overrides[get_auth_backend] = env.backend
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    yield TestClient(app)
    app.dependency_overrides.clear()


def call(client, token, method="get", path="/subscriptions", **kwargs):
    return getattr(client, method)(path, headers={"Authorization": f"Bearer {token}"}, **kwargs)


# ---------------------------------------------------------------- accepted tokens

def test_valid_hs256_token(client):
    assert call(client, hs256()).status_code == 200


def test_valid_es256_token_via_jwks(client):
    assert call(client, es256()).status_code == 200


def test_small_clock_skew_is_tolerated(client):
    assert call(client, hs256(exp=int(time.time()) - 5)).status_code == 200


# ---------------------------------------------------------------- rejected tokens (401)

def forge_alg_none():
    header = jwt.utils.base64url_encode(b'{"alg":"none","typ":"JWT"}').decode()
    body = jwt.utils.base64url_encode(json.dumps(claims()).encode()).decode()
    return f"{header}.{body}."


def tamper(token):
    head, body, sig = token.split(".")
    payload = jwt.utils.base64url_decode(body).replace(b'"authenticated"', b'"authenticatee"', 1)
    return ".".join([head, jwt.utils.base64url_encode(payload).decode(), sig])


def hs256_signed_with_public_key():
    """Classic alg-confusion attack: HMAC-sign with the (public) verification key.
    Built by hand because PyJWT refuses to create such a token."""
    pem = EC_KEY.public_key().public_bytes(serialization.Encoding.PEM,
                                           serialization.PublicFormat.SubjectPublicKeyInfo)
    header = jwt.utils.base64url_encode(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    body = jwt.utils.base64url_encode(json.dumps(claims()).encode())
    signing_input = header + b"." + body
    signature = jwt.utils.base64url_encode(hmac.new(pem, signing_input, hashlib.sha256).digest())
    return (signing_input + b"." + signature).decode()


@pytest.mark.parametrize("make_token,reason", [
    (lambda: hs256(exp=int(time.time()) - 120), "expired"),
    (lambda: hs256(aud="someone-else"), "wrong audience"),
    (lambda: hs256(aud=None), "no audience"),
    (lambda: hs256(iss="https://evil.supabase.co/auth/v1"), "wrong issuer"),
    (lambda: hs256(exp=None), "no expiry"),
    (lambda: hs256(sub=None), "no subject"),
    (lambda: hs256(sub="not-a-uuid"), "subject not a uuid"),
    (lambda: hs256(nbf=int(time.time()) + 3600), "not valid yet"),
    (lambda: hs256(role="anon"), "anon key"),
    (lambda: hs256(role="service_role"), "service role key"),
    (lambda: jwt.encode(claims(), "wrong-secret-" + "y" * 32, algorithm="HS256"), "wrong secret"),
    (lambda: tamper(hs256()), "tampered payload"),
    (lambda: es256(key=OTHER_EC_KEY), "signed by another key"),
    (lambda: es256(kid="unknown-kid"), "unknown key id"),
    (forge_alg_none, "alg none"),
    (hs256_signed_with_public_key, "alg confusion"),
    (lambda: "not-a-jwt", "garbage"),
    (lambda: jwt.encode(claims(), SECRET, algorithm="HS512"), "unsupported algorithm"),
])
def test_bad_tokens_are_rejected(client, make_token, reason):
    res = call(client, make_token())
    assert res.status_code == 401, reason
    assert "invalid_token" in res.headers["www-authenticate"]


def test_error_detail_does_not_leak_secrets(client):
    res = call(client, jwt.encode(claims(), "wrong-secret-" + "y" * 32, algorithm="HS256"))
    assert SECRET not in res.text and "unit-test" not in res.text


def test_hs256_rejected_when_project_has_no_secret(client, env):
    env.secret = None
    assert call(client, hs256()).status_code == 401
    assert call(client, es256()).status_code == 200


def test_missing_token(client):
    res = client.get("/subscriptions")
    assert res.status_code == 401 and res.headers["www-authenticate"] == "Bearer"


# ---------------------------------------------------------------- server-side failures (503)

def test_unreachable_key_server_is_503_not_401(client, env):
    env.jwk_client = FakeJwkClient(reachable=False)
    assert call(client, es256()).status_code == 503


def test_role_lookup_failure_is_503(client, env):
    env.lookup_error = RuntimeError("db down")
    assert call(client, hs256()).status_code == 503


def test_unconfigured_server_is_503(repo, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setattr("app.core.supabase_jwt.load_auth_settings", lambda: None)
    get_auth_backend.cache_clear()
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    try:
        res = TestClient(app).get("/subscriptions", headers={"Authorization": f"Bearer {hs256()}"})
    finally:
        app.dependency_overrides.clear()
        get_auth_backend.cache_clear()
    assert res.status_code == 503 and "SUPABASE" not in res.text


# ---------------------------------------------------------------- roles

def test_role_from_app_metadata(client):
    admin = hs256(app_metadata={"provider": "email", "role": "admin"})
    assert call(client, admin, "post", "/subscriptions", json={}).status_code == 422   # past auth


def test_role_from_customers_table(client, env):
    token_claims = claims()
    env.customers[token_claims["sub"]] = {"role": "staff", "is_active": True}
    token = jwt.encode(token_claims, SECRET, algorithm="HS256")
    assert call(client, token, "post", "/subscriptions", json={}).status_code == 422


def test_default_role_is_customer(client):
    assert call(client, hs256(), "post", "/subscriptions", json={}).status_code == 403


@pytest.mark.parametrize("untrusted", [
    {"user_metadata": {"role": "admin"}},           # user-editable
    {"role": "admin"},                              # top-level claim (also fails role check)
    {"app_metadata": {"role": "superuser"}},        # not a known role -> falls through to customer
])
def test_untrusted_role_sources_are_ignored(client, untrusted):
    res = call(client, hs256(**untrusted), "post", "/subscriptions", json={})
    assert res.status_code in (401, 403)


def test_x_user_role_header_is_ignored(client):
    res = client.post("/subscriptions", json={},
                      headers={"Authorization": f"Bearer {hs256()}", "X-User-Role": "admin"})
    assert res.status_code == 403


def test_disabled_account_is_403(client, env):
    token_claims = claims()
    env.customers[token_claims["sub"]] = {"role": "admin", "is_active": False}
    res = call(client, jwt.encode(token_claims, SECRET, algorithm="HS256"))
    assert res.status_code == 403 and "disabled" in res.json()["detail"]


def test_unknown_database_role_is_403(client, env):
    token_claims = claims()
    env.customers[token_claims["sub"]] = {"role": "owner", "is_active": True}
    assert call(client, jwt.encode(token_claims, SECRET, algorithm="HS256")).status_code == 403


# ---------------------------------------------------------------- end to end with data isolation

def test_customer_token_only_sees_own_subscriptions(client, env, repo):
    me, other = claims(), claims()
    seed_catalog(repo, me["sub"], other["sub"])
    for customer in (repo.customer, repo.other_customer):
        repo.insert_subscription({"customer_id": customer["id"], "plan_id": repo.plan["id"], "status": "active",
                                  "quantity": 1, "start_date": TODAY, "unit_price": 1, "total_amount": 1,
                                  "discount_amount": 0, "tax_amount": 0, "currency": "INR",
                                  "auto_renew": True})
    res = call(client, jwt.encode(me, SECRET, algorithm="HS256"))
    assert res.status_code == 200
    assert [s["customer_id"] for s in res.json()] == [repo.customer["id"]]

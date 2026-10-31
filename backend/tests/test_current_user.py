"""Security tests for Supabase access-token verification and role resolution.

Tokens are really signed (HS256 secret and an ES256 key pair generated here)
and really verified by PyJWT. Only the JWKS download and the customers table
are replaced by in-memory stand-ins.
"""
import hashlib
import importlib
import hmac
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.current_user import AuthBackend, get_auth_backend, get_team_auth
from app.core.supabase_jwt import CLOCK_SKEW_SECONDS, AuthSettings, AuthUnavailable, SupabaseTokenVerifier
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

    def get_signing_keys(self):
        if not self.reachable:
            raise jwt.PyJWKClientConnectionError("network down")
        return [type("SigningKey", (), {"key": EC_KEY.public_key(), "key_id": KID})()]

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
    """Stand-ins for the database lookup and the team's app.core.auth dependency.
    The fake team dependency mimics its contract: role from customers.role, then
    app_metadata, else customer (tests with the REAL module are further down)."""

    def __init__(self):
        self.customers = {}          # auth user id -> {"role", "is_active"}
        self.jwk_client = FakeJwkClient()
        self.secret = SECRET
        self.lookup_error = None
        self.team_calls = 0
        self.team_override = None    # dict to return instead, or an exception to raise

    def backend(self):
        settings = AuthSettings(supabase_url=SUPABASE_URL, jwt_secret=self.secret)
        def lookup(user_id):
            if self.lookup_error:
                raise self.lookup_error
            return self.customers.get(str(user_id))
        return AuthBackend(SupabaseTokenVerifier(settings, jwk_client=self.jwk_client), lookup)

    def team_auth(self):
        async def team_get_current_user(credentials):
            self.team_calls += 1
            if isinstance(self.team_override, Exception):
                raise self.team_override
            token_claims = jwt.decode(credentials.credentials, options={"verify_signature": False})
            if self.team_override is not None:
                return {"email": token_claims.get("email"), **self.team_override}
            row = self.customers.get(token_claims["sub"])
            role = (row or {}).get("role") or (token_claims.get("app_metadata") or {}).get("role") or "customer"
            return {"id": token_claims["sub"], "email": token_claims.get("email"), "role": role}
        return lambda: team_get_current_user


@pytest.fixture
def env():
    return Env()


@pytest.fixture
def repo():
    return FakeSubscriptionRepository()


@pytest.fixture
def client(env, repo):
    app.dependency_overrides[get_auth_backend] = env.backend
    app.dependency_overrides[get_team_auth] = env.team_auth
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
def test_bad_tokens_are_rejected(client, env, make_token, reason):
    res = call(client, make_token())
    assert res.status_code == 401, reason
    assert "invalid_token" in res.headers["www-authenticate"]
    assert env.team_calls == 0, "bad tokens must be rejected before the shared dependency runs"


def test_error_detail_does_not_leak_secrets(client):
    res = call(client, jwt.encode(claims(), "wrong-secret-" + "y" * 32, algorithm="HS256"))
    assert SECRET not in res.text and "unit-test" not in res.text


def test_hs256_rejected_when_project_has_no_secret(client, env):
    env.secret = None
    assert call(client, hs256()).status_code == 401
    assert call(client, es256()).status_code == 200


# ---------------------------------------------------------------- missing server configuration (503, not 401)
# These use the real PyJWKClient; only its HTTP fetch is replaced.

def real_jwk_client(monkeypatch, response):
    client = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json")

    def fetch():
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(client, "fetch_data", fetch)
    return client


def published_ec_key():
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(EC_KEY.public_key()))
    return {"keys": [{**jwk, "kid": KID, "use": "sig", "alg": "ES256"}]}


def test_hs256_project_without_secret_on_server_is_503(client, env, monkeypatch):
    """The team lead's case: SUPABASE_URL set (e.g. from .env), no
    SUPABASE_JWT_SECRET, project signs with HS256 (publishes no keys)."""
    env.secret = None
    env.jwk_client = real_jwk_client(monkeypatch, {"keys": []})
    res = call(client, hs256())
    assert res.status_code == 503 and "SUPABASE" not in res.text and env.team_calls == 0


def test_hs256_forgery_on_asymmetric_project_is_still_401(client, env, monkeypatch):
    env.secret = None
    env.jwk_client = real_jwk_client(monkeypatch, published_ec_key())
    assert call(client, hs256()).status_code == 401
    assert call(client, es256()).status_code == 200


def test_key_server_unreachable_while_checking_hs256_is_503(client, env, monkeypatch):
    env.secret = None
    env.jwk_client = real_jwk_client(monkeypatch, jwt.PyJWKClientConnectionError("network down"))
    assert call(client, hs256()).status_code == 503


@pytest.mark.parametrize("make_token", [
    lambda: hs256(exp=int(time.time()) - 120),                        # expired
    lambda: jwt.encode(claims(), "wrong-secret-" + "y" * 64, algorithm="HS256"),
    lambda: hs256(aud="someone-else"),
])
def test_configured_server_still_returns_401_for_bad_tokens(client, make_token):
    assert call(client, make_token()).status_code == 401


def test_settings_from_environment_without_secret(repo, monkeypatch):
    """End to end through the real get_auth_backend: SUPABASE_URL comes from the
    environment (as a .env file would provide), no JWT secret, HS256 project."""
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", lambda self: {"keys": []})
    get_auth_backend.cache_clear()
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    try:
        res = TestClient(app).get("/subscriptions", headers={"Authorization": f"Bearer {hs256()}"})
        expired = TestClient(app).get("/subscriptions", headers={"Authorization": "Bearer not-a-jwt"})
    finally:
        app.dependency_overrides.clear()
        get_auth_backend.cache_clear()
    assert res.status_code == 503
    assert expired.status_code == 401


def test_missing_token(client):
    res = client.get("/subscriptions")
    assert res.status_code == 401 and res.headers["www-authenticate"] == "Bearer"


# ---------------------------------------------------------------- server-side failures (503)

def test_unreachable_key_server_is_503_not_401(client, env):
    env.jwk_client = FakeJwkClient(reachable=False)
    assert call(client, es256()).status_code == 503


def test_account_status_lookup_failure_is_503(client, env):
    env.lookup_error = RuntimeError("db down")
    assert call(client, hs256()).status_code == 503


def test_unconfigured_server_is_503(repo, monkeypatch):
    # Patch the name get_auth_backend actually calls (it was imported into
    # current_user), so a developer's .env file cannot make settings appear.
    monkeypatch.setattr("app.core.current_user.load_auth_settings", lambda: None)
    get_auth_backend.cache_clear()
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    try:
        res = TestClient(app).get("/subscriptions", headers={"Authorization": f"Bearer {hs256()}"})
    finally:
        app.dependency_overrides.clear()
        get_auth_backend.cache_clear()
    assert res.status_code == 503 and "SUPABASE" not in res.text


def test_shared_auth_module_unavailable_is_503(client):
    def broken_loader():
        raise AuthUnavailable("config missing")
    app.dependency_overrides[get_team_auth] = lambda: broken_loader
    assert call(client, hs256()).status_code == 503


# ---------------------------------------------------------------- shared dependency contract

def test_shared_dependency_rejection_is_kept(client, env):
    env.team_override = HTTPException(status_code=401, detail="Invalid or expired token")
    res = call(client, hs256())
    assert res.status_code == 401 and res.json()["detail"] == "Invalid or expired token"


def test_identity_must_match_token_subject(client, env):
    env.team_override = {"id": str(uuid.uuid4()), "role": "admin"}
    assert call(client, hs256()).status_code == 401


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


# ---------------------------------------------------------------- the REAL shared module (app.core.auth)
# Runs the team's actual get_current_user code behind our local verification.
# Only its Supabase client is replaced by an in-memory stand-in.

class FakeSupabase:
    def __init__(self, customers, fail_db=False):
        self.rows, self.fail_db = customers, fail_db
        self.auth = type("Auth", (), {"get_user": staticmethod(self._get_user)})()

    @staticmethod
    def _get_user(token):
        c = jwt.decode(token, options={"verify_signature": False})
        user = type("User", (), {"id": c["sub"], "email": c.get("email"),
                                 "user_metadata": c.get("user_metadata") or {},
                                 "app_metadata": c.get("app_metadata") or {},
                                 "email_confirmed_at": "2026-10-31", "confirmed_at": None})()
        return type("UserResponse", (), {"user": user})()

    def table(self, name):
        outer = self

        class Query:
            def __init__(self):
                self.filters, self.values = [], None

            def select(self, *_):
                return self

            def eq(self, column, value):
                self.filters.append((column, value))
                return self

            def is_(self, column, _):
                self.filters.append((column, None))
                return self

            def update(self, values):
                self.values = values
                return self

            def execute(self):
                if outer.fail_db:
                    raise RuntimeError("db timeout")
                rows = [r for r in outer.rows if all(r.get(c) == v for c, v in self.filters)]
                for r in rows if self.values else []:
                    r.update(self.values)
                return type("Result", (), {"data": rows})()

        return Query()


@pytest.fixture
def real_team(monkeypatch, env, repo):
    monkeypatch.setenv("SUPABASE_URL", "https://unit-test-project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-key")
    team_module = importlib.import_module("app.core.auth")
    state = {"rows": [], "fail_db": False}

    def install():
        monkeypatch.setattr(team_module, "supabase", FakeSupabase(state["rows"], state["fail_db"]))

    app.dependency_overrides[get_auth_backend] = env.backend
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    yield state, install, TestClient(app)
    app.dependency_overrides.clear()


def create_as(client, token):
    return client.post("/subscriptions", json={}, headers={"Authorization": f"Bearer {token}"})


@pytest.mark.parametrize("token_claims,staff_row,fail_db,expected", [
    (dict(user_metadata={"role": "admin"}), False, False, 403),     # self-set role: ignored
    (dict(user_metadata={"role": "staff"}), False, False, 403),
    (dict(user_metadata={"role": "admin"}), False, True, 403),      # DB-error fallback
    (dict(app_metadata={"role": "admin"}), False, False, 422),      # trusted -> past auth
    (dict(app_metadata={"role": "admin"}), False, True, 422),
    (dict(), True, False, 422),                                     # customers.role = staff
    (dict(app_metadata={"role": "owner"}), False, True, 403),       # unknown role refused here
])
def test_real_shared_module_roles(real_team, token_claims, staff_row, fail_db, expected):
    state, install, client = real_team
    c = claims(**token_claims)
    if staff_row:
        state["rows"].append({"id": "c1", "auth_user_id": c["sub"], "email": c["email"], "role": "staff"})
    state["fail_db"] = fail_db
    install()
    assert create_as(client, jwt.encode(c, SECRET, algorithm="HS256")).status_code == expected


def test_real_shared_module_disabled_account(real_team, env):
    state, install, client = real_team
    c = claims()
    state["rows"].append({"id": "c1", "auth_user_id": c["sub"], "email": c["email"], "role": "admin"})
    env.customers[c["sub"]] = {"is_active": False}
    install()
    res = create_as(client, jwt.encode(c, SECRET, algorithm="HS256"))
    assert res.status_code == 403 and "disabled" in res.json()["detail"]


def test_real_shared_module_never_sees_forged_tokens(real_team):
    state, install, client = real_team
    install()
    forged = jwt.encode(claims(app_metadata={"role": "admin"}), "attacker-secret-" + "z" * 64, algorithm="HS256")
    assert create_as(client, forged).status_code == 401


# ---------------------------------------------------------------- per-token cache

def test_repeated_requests_reuse_the_verified_user(client, env):
    token = hs256()
    for _ in range(5):
        assert call(client, token).status_code == 200
    assert env.team_calls == 1, "the shared dependency should run once per token, not per request"


def test_cache_does_not_outlive_the_token(client, env):
    token = hs256(exp=int(time.time()) + 1)
    assert call(client, token).status_code == 200
    time.sleep(1.2 + CLOCK_SKEW_SECONDS)
    assert call(client, token).status_code == 401


def test_rejected_tokens_are_not_cached(client, env):
    token = hs256()
    env.team_override = HTTPException(status_code=401, detail="Invalid or expired token")
    assert call(client, token).status_code == 401
    env.team_override = None
    assert call(client, token).status_code == 200
    assert env.team_calls == 2

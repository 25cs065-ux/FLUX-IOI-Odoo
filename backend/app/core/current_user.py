"""
Authentication dependency for the Subscriptions / Invoices / Payments API.

Uses the team's agreed dependency, app.core.auth.get_current_user, for the
user's identity and role, and keeps the stricter checks around it:

  1. local token verification (app.core.supabase_jwt): signature, expiry,
     audience, issuer, role claim "authenticated", UUID subject. Runs first,
     so malformed or forged tokens are rejected without a network call.
  2. app.core.auth.get_current_user: Supabase-side user check and the team's
     role rules (customers.role, then app_metadata; never user_metadata).
  3. here again: its user id must equal the token subject, its role must be
     admin / staff / customer, and a customers row with is_active = false is
     refused.

Responses: no token 401 · invalid/expired token 401 · disabled account 403 ·
unknown role 403 · auth not configured / Supabase unreachable 503.
The X-User-Role header and user_metadata are never used.
"""
import asyncio
import inspect
import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from typing import Awaitable, Callable, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.supabase_jwt import (
    AuthUnavailable,
    InvalidToken,
    SupabaseTokenVerifier,
    load_auth_settings,
)

logger = logging.getLogger(__name__)


class Role(str, Enum):
    ADMIN = "admin"
    STAFF = "staff"
    CUSTOMER = "customer"


@dataclass(frozen=True)
class CurrentUser:
    id: UUID                    # auth.users.id (token "sub")
    role: Role
    email: Optional[str] = None


# Returns {"is_active": ...} for the customers row linked to the auth user, or None.
CustomerLookup = Callable[[UUID], Optional[dict]]
# The team dependency: (credentials) -> {"id", "email", "role"}, sync or async.
TeamAuth = Callable[[HTTPAuthorizationCredentials], "dict | Awaitable[dict]"]


def _supabase_customer_lookup(user_id: UUID) -> Optional[dict]:
    from app.core.database import get_supabase

    res = (get_supabase().table("customers").select("is_active")
           .eq("auth_user_id", str(user_id)).limit(1).execute())
    return res.data[0] if res.data else None


class AuthBackend:
    """Local token verification plus the disabled-account check."""

    def __init__(self, verifier: Optional[SupabaseTokenVerifier],
                 customer_lookup: CustomerLookup = _supabase_customer_lookup):
        self.verifier = verifier
        self.customer_lookup = customer_lookup

    def verify(self, token: str) -> dict:
        if self.verifier is None:
            raise AuthUnavailable("SUPABASE_URL is not configured")
        return self.verifier.verify(token)

    def is_disabled(self, user_id: UUID) -> bool:
        try:
            customer = self.customer_lookup(user_id)
        except Exception as exc:
            raise AuthUnavailable("Cannot check the account status") from exc
        return bool(customer) and customer.get("is_active") is False


@lru_cache
def get_auth_backend() -> AuthBackend:
    """FastAPI dependency (cached; key fetching is lazy). Tests override it."""
    settings = load_auth_settings()
    return AuthBackend(SupabaseTokenVerifier(settings) if settings else None)


def _load_team_auth() -> TeamAuth:
    # Imported on first use: app.core.config builds its settings at import time.
    try:
        from app.core.auth import get_current_user as team_get_current_user
    except Exception as exc:
        raise AuthUnavailable("Shared auth module unavailable") from exc
    return team_get_current_user


def get_team_auth() -> Callable[[], TeamAuth]:
    """FastAPI dependency returning a loader for the team dependency. Tests override it."""
    return _load_team_auth


bearer_scheme = HTTPBearer(auto_error=False, description="Supabase Auth access token")


def _unavailable() -> HTTPException:
    logger.exception("Authentication unavailable")
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                         detail="Authentication is not configured on this server")


# Verified users, keyed by access token. A page load sends many API calls with
# the same token; without this each one repeats the Supabase Auth round trip
# and the account lookups. Entries live at most AUTH_CACHE_SECONDS and never
# past the token's own expiry, so role or account changes apply within that.
AUTH_CACHE_SECONDS = 30
_AUTH_CACHE_MAX = 1024
_auth_cache: "OrderedDict[str, tuple[float, CurrentUser]]" = OrderedDict()
_auth_cache_lock = threading.Lock()
_verify_locks: "dict[str, asyncio.Lock]" = {}


def clear_auth_cache() -> None:
    with _auth_cache_lock:
        _auth_cache.clear()


def _cached_user(token: str) -> Optional[CurrentUser]:
    with _auth_cache_lock:
        entry = _auth_cache.get(token)
        if entry and entry[0] > time.time():
            return entry[1]
        _auth_cache.pop(token, None)
        return None


def _remember_user(token: str, user: CurrentUser, token_exp) -> None:
    expires = time.time() + AUTH_CACHE_SECONDS
    if isinstance(token_exp, (int, float)):
        expires = min(expires, float(token_exp))
    with _auth_cache_lock:
        _auth_cache[token] = (expires, user)
        while len(_auth_cache) > _AUTH_CACHE_MAX:
            _auth_cache.popitem(last=False)


async def _call_team_auth(team: TeamAuth, credentials: HTTPAuthorizationCredentials) -> dict:
    # The shared dependency makes blocking network calls; run a plain function
    # in the threadpool so it never stalls the event loop for other requests.
    if inspect.iscoroutinefunction(team):
        return await team(credentials)
    return await run_in_threadpool(team, credentials)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    backend: AuthBackend = Depends(get_auth_backend),
    team_auth: Callable[[], TeamAuth] = Depends(get_team_auth),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated",
                            headers={"WWW-Authenticate": "Bearer"})
    token = credentials.credentials
    cached = _cached_user(token)
    if cached:
        return cached
    # A page load sends several requests with a new token at once: let one of
    # them verify it while the others wait and reuse the result.
    lock = _verify_locks.setdefault(token, asyncio.Lock())
    try:
        async with lock:
            return _cached_user(token) or await _verify(token, credentials, backend, team_auth)
    finally:
        if not lock.locked():
            _verify_locks.pop(token, None)


async def _verify(token: str, credentials: HTTPAuthorizationCredentials, backend: AuthBackend,
                  team_auth: Callable[[], TeamAuth]) -> CurrentUser:
    try:
        # Signature checks can fetch the project's keys: keep that off the event loop too.
        claims = await run_in_threadpool(backend.verify, token)
        identity = await _call_team_auth(team_auth(), credentials)   # raises its own 401
        user_id = UUID(str(claims["sub"]))
        if str(identity.get("id")) != str(user_id):
            raise InvalidToken("Token subject does not match the authenticated user")
        if await run_in_threadpool(backend.is_disabled, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled")
    except InvalidToken as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc),
                            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})
    except AuthUnavailable:
        raise _unavailable()

    role = identity.get("role")
    if role not in Role._value2member_map_:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account has no valid role")
    user = CurrentUser(id=user_id, role=Role(role), email=identity.get("email") or claims.get("email"))
    _remember_user(token, user, claims.get("exp"))
    return user


def require_roles(*roles: Role):
    """Dependency factory: allow only the given roles, return the user."""
    allowed = set(roles)

    def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return user

    return checker

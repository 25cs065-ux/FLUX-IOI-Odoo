"""
Authentication dependency for the API: Supabase Auth access tokens are
verified locally (app.core.supabase_jwt) and mapped to a CurrentUser.

Where the role comes from (most trusted first):
  1. the token's app_metadata.role   - only the service role / admin API can set it
  2. customers.role for the row with auth_user_id = token sub
  3. otherwise "customer"
Never used for roles: user_metadata (editable by the user), the token's own
"role" claim (always "authenticated"), request headers such as X-User-Role,
or email matching.

Responses: no token 401 · invalid/expired token 401 · disabled account 403 ·
unknown role 403 · server not configured / key server unreachable 503.
"""
import logging
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from typing import Callable, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
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


# Returns {"role": ..., "is_active": ...} for the customers row linked to the
# auth user, or None. Lets tests run without a database.
CustomerLookup = Callable[[UUID], Optional[dict]]


def _supabase_customer_lookup(user_id: UUID) -> Optional[dict]:
    from app.core.database import get_supabase

    res = (get_supabase().table("customers").select("role,is_active")
           .eq("auth_user_id", str(user_id)).limit(1).execute())
    return res.data[0] if res.data else None


class AuthBackend:
    def __init__(self, verifier: Optional[SupabaseTokenVerifier],
                 customer_lookup: CustomerLookup = _supabase_customer_lookup):
        self.verifier = verifier
        self.customer_lookup = customer_lookup

    def authenticate(self, token: str) -> CurrentUser:
        if self.verifier is None:
            raise AuthUnavailable("SUPABASE_URL is not configured")
        claims = self.verifier.verify(token)
        user_id = UUID(str(claims["sub"]))
        return CurrentUser(id=user_id, role=self._role(user_id, claims), email=claims.get("email"))

    def _role(self, user_id: UUID, claims: dict) -> Role:
        app_metadata = claims.get("app_metadata") if isinstance(claims.get("app_metadata"), dict) else {}
        if app_metadata.get("role") in Role._value2member_map_:
            return Role(app_metadata["role"])
        try:
            customer = self.customer_lookup(user_id)
        except Exception as exc:
            raise AuthUnavailable("Cannot load the user's role") from exc
        if customer is None:
            return Role.CUSTOMER
        if customer.get("is_active") is False:
            raise PermissionError("This account is disabled")
        role = customer.get("role") or Role.CUSTOMER.value
        if role not in Role._value2member_map_:
            raise PermissionError("Your account has no valid role")
        return Role(role)


@lru_cache
def get_auth_backend() -> AuthBackend:
    """FastAPI dependency (cached; key fetching is lazy). Tests override it."""
    settings = load_auth_settings()
    return AuthBackend(SupabaseTokenVerifier(settings) if settings else None)


bearer_scheme = HTTPBearer(auto_error=False, description="Supabase Auth access token")


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    backend: AuthBackend = Depends(get_auth_backend),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        return backend.authenticate(credentials.credentials)
    except InvalidToken as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc),
                            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except AuthUnavailable:
        logger.exception("Authentication unavailable")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Authentication is not configured on this server")


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

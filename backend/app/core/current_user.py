"""
Auth contract used by the subscription / invoice / payment routers.

Token verification is NOT implemented here. It is delegated to the team's
shared Supabase Auth dependency, app.core.auth.get_current_user, which
verifies the access token with Supabase (supabase.auth.get_user) and resolves
the app role. It returns {"id", "email", "role"}; this module adapts that to
CurrentUser so the routers stay unchanged.

Fails closed:
  * no bearer token                          -> 401
  * shared auth module missing / misconfigured -> 503 (never lets a request through)
  * token rejected by the shared dependency  -> its own 401
  * role outside admin/staff/customer        -> 403
"""
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

SHARED_AUTH_MODULE = "app.core.auth"


class Role(str, Enum):
    ADMIN = "admin"
    STAFF = "staff"
    CUSTOMER = "customer"


@dataclass(frozen=True)
class CurrentUser:
    id: UUID                    # auth.users.id (Supabase user id)
    role: Role
    email: Optional[str] = None


bearer_scheme = HTTPBearer(auto_error=False, description="Supabase Auth access token")

_NOT_CONFIGURED = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="Authentication is not configured on this server",
)


def _shared_verifier() -> Callable:
    """Import lazily: the shared module reads Supabase settings at import time."""
    try:
        from app.core.auth import get_current_user as verify
    except ModuleNotFoundError as exc:
        if exc.name == SHARED_AUTH_MODULE:
            logger.error("Shared auth module %s is not present on this branch", SHARED_AUTH_MODULE)
        else:
            logger.exception("Shared auth module failed to import")
        raise _NOT_CONFIGURED from exc
    except Exception as exc:        # e.g. missing SUPABASE_* settings
        logger.exception("Shared auth module failed to import")
        raise _NOT_CONFIGURED from exc
    return verify


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    verified = _shared_verifier()(credentials)   # raises its own 401 for bad tokens

    try:
        user_id = UUID(str(verified["id"]))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")
    try:
        role = Role(verified.get("role"))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account has no valid role")
    return CurrentUser(id=user_id, role=role, email=verified.get("email"))


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

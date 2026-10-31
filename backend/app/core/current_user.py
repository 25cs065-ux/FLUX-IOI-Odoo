"""
Auth contract used by the subscription / invoice / payment routers.

The team is wiring Supabase Auth JWT verification into a shared dependency.
Until that lands, get_current_user() FAILS CLOSED: requests without a bearer
token get 401 and requests with one get 503. Nothing is ever let through.

To plug in the shared dependency, replace the body of get_current_user() so
it verifies the Supabase JWT and returns a CurrentUser:
    id   -> the JWT "sub" claim (auth.users.id)
    role -> "admin" | "staff" | "customer"
Routers depend only on CurrentUser and require_roles(), so they will not
need to change.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


class Role(str, Enum):
    ADMIN = "admin"
    STAFF = "staff"
    CUSTOMER = "customer"


@dataclass(frozen=True)
class CurrentUser:
    id: UUID                    # auth.users.id (Supabase JWT "sub")
    role: Role
    email: Optional[str] = None


bearer_scheme = HTTPBearer(auto_error=False, description="Supabase Auth access token")


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> CurrentUser:
    """Placeholder for the shared Supabase Auth dependency. Fails closed."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Supabase JWT verification is not configured yet",
    )


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

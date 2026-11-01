"""Signed-in user's profile.

The frontend uses this to route by role (customer -> portal, admin/staff ->
dashboard) and to show the user's name, so it relies on the same role
resolution the backend enforces instead of guessing from token claims.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.current_user import CurrentUser, Role, require_roles
from app.repositories.subscription_repository import (
    SubscriptionRepository,
    get_subscription_repository,
)

router = APIRouter(prefix="/me", tags=["me"])

any_role = require_roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)


class MeResponse(BaseModel):
    id: str
    email: Optional[str] = None
    role: Role
    name: Optional[str] = None
    customer_id: Optional[str] = None


@router.get("", response_model=MeResponse, summary="The signed-in user's role and name",
            responses={401: {"description": "Missing or invalid Supabase access token"}})
def get_me(
    user: CurrentUser = Depends(any_role),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    customer = repo.get_customer_by_auth_user(user.id) or {}
    return MeResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        name=customer.get("name"),
        customer_id=str(customer["id"]) if customer.get("id") else None,
    )

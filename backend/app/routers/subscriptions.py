"""Subscriptions API.

RBAC
  admin, staff : full access
  customer     : read their own subscriptions (others return 404) and accept
                 (confirm) their own quotations
"""
from contextlib import contextmanager
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.core.current_user import CurrentUser, Role, require_roles
from app.repositories.subscription_repository import (
    SubscriptionRepository,
    get_subscription_repository,
)
from app.schemas.subscription import (
    ReasonRequest,
    RenewRequest,
    StatusHistoryResponse,
    SubscriptionCreate,
    SubscriptionDetail,
    SubscriptionStatus,
    SubscriptionSummary,
    SubscriptionUpdate,
)
from app.services import subscription_service as service

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

staff_only = require_roles(Role.ADMIN, Role.STAFF)
any_role = require_roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)

ERROR_RESPONSES = {
    401: {"description": "Missing or invalid Supabase access token"},
    403: {"description": "Role not allowed"},
    404: {"description": "Subscription not found (or not yours)"},
}
TRANSITION_RESPONSES = {**ERROR_RESPONSES, 409: {"description": "Transition not allowed from current status"}}


@contextmanager
def service_errors():
    try:
        yield
    except service.SubscriptionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=List[SubscriptionSummary], responses=ERROR_RESPONSES,
            summary="List subscriptions")
def list_subscriptions(
    status_filter: Optional[SubscriptionStatus] = Query(None, alias="status"),
    customer_id: Optional[UUID] = Query(None, description="Ignored for customers (always their own)"),
    plan_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(any_role),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    """Newest first. Customers only ever see their own subscriptions."""
    with service_errors():
        return service.list_subscriptions(repo, user, status=status_filter, customer_id=customer_id,
                                          plan_id=plan_id, limit=limit, offset=offset)


@router.post("", response_model=SubscriptionDetail, status_code=status.HTTP_201_CREATED,
             responses={**ERROR_RESPONSES, 422: {"description": "Invalid input or references"}},
             summary="Create a draft subscription")
def create_subscription(
    payload: SubscriptionCreate,
    user: CurrentUser = Depends(staff_only),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    """Creates a subscription in `draft`. Line prices default from the product
    (+ variant extra price); with no lines, one line is created from the plan.
    Totals are calculated server side."""
    with service_errors():
        return service.create_subscription(repo, payload, user)


@router.get("/{subscription_id}", response_model=SubscriptionDetail, responses=ERROR_RESPONSES,
            summary="Get a subscription with its lines")
def get_subscription(
    subscription_id: UUID,
    user: CurrentUser = Depends(any_role),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    with service_errors():
        return service.get_subscription_detail(repo, subscription_id, user)


@router.patch("/{subscription_id}", response_model=SubscriptionDetail,
              responses={**TRANSITION_RESPONSES, 422: {"description": "Invalid input"}},
              summary="Update a subscription")
def update_subscription(
    subscription_id: UUID,
    payload: SubscriptionUpdate,
    user: CurrentUser = Depends(staff_only),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    """All fields are editable in `draft`/`quotation`; afterwards only `notes`
    and `auto_renew`. Sending `lines` replaces every line and re-prices."""
    with service_errors():
        return service.update_subscription(repo, subscription_id, payload, user)


@router.get("/{subscription_id}/history", response_model=List[StatusHistoryResponse],
            responses=ERROR_RESPONSES, summary="Status change history")
def get_history(
    subscription_id: UUID,
    user: CurrentUser = Depends(any_role),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    with service_errors():
        return service.list_history(repo, subscription_id, user)


# ---------------------------------------------------------------- lifecycle actions

def _action(name: str, func, summary: str, dependency):
    def endpoint(
        subscription_id: UUID,
        body: Optional[ReasonRequest] = Body(None),
        user: CurrentUser = Depends(dependency),
        repo: SubscriptionRepository = Depends(get_subscription_repository),
    ):
        with service_errors():
            return func(repo, subscription_id, user, body.reason if body else None)

    endpoint.__name__ = f"{name.replace('-', '_')}_subscription"
    router.add_api_route(f"/{{subscription_id}}/{name}", endpoint, methods=["POST"],
                         response_model=SubscriptionSummary, responses=TRANSITION_RESPONSES,
                         summary=summary)


_action("send-quotation", service.send_quotation, "draft -> quotation (assigns quotation number)", staff_only)
_action("confirm", service.confirm, "draft/quotation -> confirmed (customers: own quotation only)", any_role)
_action("activate", service.activate, "confirmed -> active", staff_only)
_action("pause", service.pause, "active -> paused (plan must be pausable)", staff_only)
_action("resume", service.resume, "paused -> active", staff_only)
_action("close", service.close, "Close / cancel (early close needs a closable_early plan)", staff_only)


@router.post("/{subscription_id}/renew", response_model=SubscriptionSummary,
             responses={**TRANSITION_RESPONSES, 422: {"description": "Invalid new_end_date"}},
             summary="Renew an active subscription")
def renew_subscription(
    subscription_id: UUID,
    payload: RenewRequest = Body(default_factory=RenewRequest),
    user: CurrentUser = Depends(staff_only),
    repo: SubscriptionRepository = Depends(get_subscription_repository),
):
    """Extends `end_date` (default: by the current term length). The plan must
    be `renewable` and the subscription must have an end date."""
    with service_errors():
        return service.renew(repo, subscription_id, payload, user)

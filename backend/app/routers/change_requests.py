"""Change requests API (a customer asks for a change to a subscription).

RBAC
  admin, staff : list/read every request, create one on behalf of a customer
  admin        : change a request's status
  customer     : create, list and read their own requests only (others return 404)
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.current_user import CurrentUser, Role, require_roles
from app.repositories.change_request_repository import (
    ChangeRequestRepository,
    get_change_request_repository,
)
from app.schemas.change_request import (
    TERMINAL_STATUSES,
    ChangeRequestCreate,
    ChangeRequestResponse,
    ChangeRequestStatus,
    ChangeRequestUpdate,
)

router = APIRouter(prefix="/change-requests", tags=["Change Requests"])

any_role = require_roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)
admin_only = require_roles(Role.ADMIN)

NOT_FOUND = "Change request not found"


def _own_customer_id(repo: ChangeRequestRepository, user: CurrentUser) -> Optional[str]:
    customer = repo.get_customer_by_auth_user(user.id)
    return str(customer["id"]) if customer else None


def _visible_request(repo: ChangeRequestRepository, request_id: UUID, user: CurrentUser) -> dict:
    record = repo.get_request(request_id)
    if not record or (user.role == Role.CUSTOMER
                      and str(record["customer_id"]) != _own_customer_id(repo, user)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return record


@router.post("/", response_model=ChangeRequestResponse, status_code=status.HTTP_201_CREATED)
def create_change_request(
    payload: ChangeRequestCreate,
    user: CurrentUser = Depends(any_role),
    repo: ChangeRequestRepository = Depends(get_change_request_repository),
):
    if user.role == Role.CUSTOMER:
        customer_id = _own_customer_id(repo, user)
        if customer_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Your account is not linked to a customer record")
    else:
        if payload.customer_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="customer_id is required")
        customer = repo.get_customer(payload.customer_id)
        if not customer or customer.get("is_active") is False:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Customer not found or inactive")
        customer_id = str(customer["id"])

    if payload.subscription_id is not None:
        sub = repo.get_subscription(payload.subscription_id)
        if not sub or str(sub["customer_id"]) != customer_id:
            # Same answer whether it is missing or someone else's.
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Subscription not found for this customer")

    return repo.insert_request({
        "customer_id": customer_id,
        "subscription_id": payload.subscription_id,
        "request_type": payload.request_type.value,
        "details": payload.details,
        "status": ChangeRequestStatus.PENDING.value,
    })


@router.get("/", response_model=List[ChangeRequestResponse])
def list_change_requests(
    status_filter: Optional[ChangeRequestStatus] = Query(None, alias="status"),
    customer_id: Optional[UUID] = Query(None, description="Ignored for customers (always their own)"),
    subscription_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(any_role),
    repo: ChangeRequestRepository = Depends(get_change_request_repository),
):
    if user.role == Role.CUSTOMER:
        customer_id = _own_customer_id(repo, user)
        if customer_id is None:
            return []
    return repo.list_requests(customer_id=customer_id, subscription_id=subscription_id,
                              status=status_filter.value if status_filter else None,
                              limit=limit, offset=offset)


@router.get("/{request_id}", response_model=ChangeRequestResponse)
def get_change_request(
    request_id: UUID,
    user: CurrentUser = Depends(any_role),
    repo: ChangeRequestRepository = Depends(get_change_request_repository),
):
    return _visible_request(repo, request_id, user)


@router.patch("/{request_id}", response_model=ChangeRequestResponse)
def update_change_request_status(
    request_id: UUID,
    payload: ChangeRequestUpdate,
    user: CurrentUser = Depends(admin_only),
    repo: ChangeRequestRepository = Depends(get_change_request_repository),
):
    existing = _visible_request(repo, request_id, user)
    if existing.get("status") in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot modify a change request that is already '{existing.get('status')}'",
        )
    updated = repo.update_request(request_id, {
        "status": payload.status.value,
        "updated_at": datetime.now(timezone.utc),
    })
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return updated

"""Payments API.

RBAC
  admin    : everything, including refunds
  staff    : record / confirm / fail payments, recalculate balances
  customer : read their own payments
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Response, status

from app.core.current_user import CurrentUser, Role, require_roles
from app.repositories.payment_repository import PaymentRepository, get_payment_repository
from app.routers.subscriptions import service_errors
from app.schemas.invoice import InvoiceSummary
from app.schemas.payment import (
    PaymentCreate,
    PaymentResponse,
    PaymentResult,
    PaymentStatus,
    RefundRequest,
)
from app.services import payment_service as service

router = APIRouter(prefix="/payments", tags=["payments"])

admin_only = require_roles(Role.ADMIN)
staff_only = require_roles(Role.ADMIN, Role.STAFF)
any_role = require_roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)

ERROR_RESPONSES = {
    401: {"description": "Missing or invalid Supabase access token"},
    403: {"description": "Role not allowed"},
    404: {"description": "Payment or invoice not found (or not yours)"},
}
CONFLICT = {409: {"description": "Not allowed in the current status, overpayment, or duplicate reference"}}


@router.get("", response_model=List[PaymentResponse], responses=ERROR_RESPONSES, summary="List payments")
def list_payments(
    status_filter: Optional[PaymentStatus] = Query(None, alias="status"),
    invoice_id: Optional[UUID] = None,
    customer_id: Optional[UUID] = Query(None, description="Ignored for customers (always their own)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(any_role),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    with service_errors():
        return service.list_payments(repo, user, status=status_filter, invoice_id=invoice_id,
                                     customer_id=customer_id, limit=limit, offset=offset)


@router.post("", response_model=PaymentResult, status_code=status.HTTP_201_CREATED,
             responses={**ERROR_RESPONSES, **CONFLICT,
                        200: {"description": "Replay of an already recorded payment_reference"},
                        422: {"description": "Invalid input or currency mismatch"}},
             summary="Record a payment against an invoice")
def record_payment(
    payload: PaymentCreate,
    response: Response,
    user: CurrentUser = Depends(staff_only),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    """Records a full or partial payment on a sent / partial / overdue invoice
    and updates its balance (`amount_paid`, `amount_due`, status `partial` or
    `paid`). Pending + completed payments can never exceed the invoice total.
    Send a `payment_reference` to make retries safe: the same reference
    returns the original payment (HTTP 200) instead of recording it twice."""
    with service_errors():
        result, created = service.record_payment(repo, payload, user)
    if not created:
        response.status_code = status.HTTP_200_OK
    return result


@router.get("/{payment_id}", response_model=PaymentResponse, responses=ERROR_RESPONSES,
            summary="Get a payment")
def get_payment(
    payment_id: UUID,
    user: CurrentUser = Depends(any_role),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    with service_errors():
        return service.get_payment(repo, payment_id, user)


@router.post("/{payment_id}/confirm", response_model=PaymentResult,
             responses={**ERROR_RESPONSES, **CONFLICT}, summary="pending -> completed")
def confirm_payment(
    payment_id: UUID,
    user: CurrentUser = Depends(staff_only),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    """Confirms a pending (e.g. gateway) payment and applies it to the invoice balance."""
    with service_errors():
        return service.confirm_payment(repo, payment_id, user)


@router.post("/{payment_id}/fail", response_model=PaymentResult,
             responses={**ERROR_RESPONSES, **CONFLICT}, summary="pending -> failed")
def fail_payment(
    payment_id: UUID,
    user: CurrentUser = Depends(staff_only),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    """Marks a pending payment failed, releasing the amount it reserved on the invoice."""
    with service_errors():
        return service.fail_payment(repo, payment_id, user)


@router.post("/{payment_id}/refund", response_model=PaymentResult,
             responses={**ERROR_RESPONSES, **CONFLICT}, summary="Refund a payment (admin only)")
def refund_payment(
    payment_id: UUID,
    payload: RefundRequest = Body(default_factory=RefundRequest),
    user: CurrentUser = Depends(admin_only),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    """Full (default) or partial refund of a completed payment. The payment
    becomes `refunded` / `partially_refunded` and the invoice balance is
    reduced (a paid invoice goes back to partial / sent / overdue)."""
    with service_errors():
        return service.refund_payment(repo, payment_id, payload, user)


@router.post("/recalculate/{invoice_id}", response_model=InvoiceSummary,
             responses={**ERROR_RESPONSES, **CONFLICT}, summary="Recalculate an invoice balance")
def recalculate_invoice_balance(
    invoice_id: UUID,
    user: CurrentUser = Depends(staff_only),
    repo: PaymentRepository = Depends(get_payment_repository),
):
    """Re-derives `amount_paid` and status from the invoice's payments. Safe to
    run at any time; use it to repair a balance after an interrupted request."""
    with service_errors():
        return service.sync_invoice_balance(repo, invoice_id)

"""Invoices API.

RBAC
  admin, staff : full access, including billing jobs
  customer     : read their own invoices once issued (drafts are hidden)
"""
from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, status

from app.core.current_user import CurrentUser, Role, require_roles
from app.repositories.invoice_repository import InvoiceRepository, get_invoice_repository
from app.routers.subscriptions import service_errors
from app.schemas.invoice import (
    BillingRunRequest,
    BillingRunResult,
    InvoiceCreate,
    InvoiceDetail,
    InvoiceGenerate,
    InvoiceStatus,
    InvoiceSummary,
    InvoiceUpdate,
    OverdueRunResult,
)
from app.services import invoice_service as service

router = APIRouter(prefix="/invoices", tags=["invoices"])

staff_only = require_roles(Role.ADMIN, Role.STAFF)
any_role = require_roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)

ERROR_RESPONSES = {
    401: {"description": "Missing or invalid Supabase access token"},
    403: {"description": "Role not allowed"},
    404: {"description": "Invoice not found (or not yours)"},
}
CONFLICT = {409: {"description": "Not allowed in the current status, or period already invoiced"}}
INVALID = {422: {"description": "Invalid input or references"}}


@router.get("", response_model=List[InvoiceSummary], responses=ERROR_RESPONSES, summary="List invoices")
def list_invoices(
    status_filter: Optional[InvoiceStatus] = Query(None, alias="status"),
    customer_id: Optional[UUID] = Query(None, description="Ignored for customers (always their own)"),
    subscription_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(any_role),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    """Newest issue date first. Customers only see their own non-draft invoices."""
    with service_errors():
        return service.list_invoices(repo, user, status=status_filter, customer_id=customer_id,
                                     subscription_id=subscription_id, limit=limit, offset=offset)


@router.post("", response_model=InvoiceDetail, status_code=status.HTTP_201_CREATED,
             responses={**ERROR_RESPONSES, **INVALID}, summary="Create a manual invoice")
def create_invoice(
    payload: InvoiceCreate,
    user: CurrentUser = Depends(staff_only),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    """Ad-hoc draft invoice. due_date defaults to issue_date + payment terms
    `days_due` (due on receipt without terms). Totals are calculated server side."""
    with service_errors():
        return service.create_invoice(repo, payload, user)


@router.post("/generate", response_model=InvoiceDetail, status_code=status.HTTP_201_CREATED,
             responses={**ERROR_RESPONSES, **CONFLICT}, summary="Invoice a subscription's next period")
def generate_invoice(
    payload: InvoiceGenerate,
    user: CurrentUser = Depends(staff_only),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    """Bills the period starting at the subscription's `next_billing_date`
    (one plan interval, capped at `end_date`), copies its lines with a tax
    snapshot, and advances `next_billing_date`. Each period is billed once."""
    with service_errors():
        return service.generate_invoice(repo, payload.subscription_id, user, payload.issue_date)


@router.post("/billing-run", response_model=BillingRunResult, responses=ERROR_RESPONSES,
             summary="Invoice all subscriptions that are due")
def billing_run(
    payload: BillingRunRequest = Body(default_factory=BillingRunRequest),
    user: CurrentUser = Depends(staff_only),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    """Generates invoices for every active subscription with
    `next_billing_date <= as_of`, catching up on missed periods. Safe to re-run:
    a period that already has an invoice is never billed again, and the
    subscription is moved past it (`recovered`). A failing subscription is
    reported in `failed` and does not stop the others."""
    with service_errors():
        return service.billing_run(repo, user, payload.as_of)


@router.post("/mark-overdue", response_model=OverdueRunResult, responses=ERROR_RESPONSES,
             summary="Mark unpaid invoices past their due date as overdue")
def mark_overdue(
    as_of: Optional[date] = Query(None, description="Defaults to today"),
    user: CurrentUser = Depends(staff_only),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    with service_errors():
        return {"marked_overdue": service.mark_overdue(repo, as_of)}


@router.get("/{invoice_id}", response_model=InvoiceDetail, responses=ERROR_RESPONSES,
            summary="Get an invoice with its lines")
def get_invoice(
    invoice_id: UUID,
    user: CurrentUser = Depends(any_role),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    with service_errors():
        return service.get_invoice_detail(repo, invoice_id, user)


@router.patch("/{invoice_id}", response_model=InvoiceDetail,
              responses={**ERROR_RESPONSES, **CONFLICT, **INVALID}, summary="Update an invoice")
def update_invoice(
    invoice_id: UUID,
    payload: InvoiceUpdate,
    user: CurrentUser = Depends(staff_only),
    repo: InvoiceRepository = Depends(get_invoice_repository),
):
    """Drafts are fully editable (`lines` replaces all lines). Changing
    issue_date or payment terms recomputes due_date unless one is given.
    Issued invoices only accept `notes`."""
    with service_errors():
        return service.update_invoice(repo, invoice_id, payload, user)


def _action(name: str, func, summary: str):
    def endpoint(
        invoice_id: UUID,
        user: CurrentUser = Depends(staff_only),
        repo: InvoiceRepository = Depends(get_invoice_repository),
    ):
        with service_errors():
            return func(repo, invoice_id, user)

    endpoint.__name__ = f"{name}_invoice"
    router.add_api_route(f"/{{invoice_id}}/{name}", endpoint, methods=["POST"],
                         response_model=InvoiceSummary, responses={**ERROR_RESPONSES, **CONFLICT},
                         summary=summary)


_action("send", service.send_invoice, "draft -> sent (a zero-total invoice goes straight to paid)")
_action("cancel", service.cancel_invoice, "draft -> cancelled (frees the billing period)")
_action("void", service.void_invoice, "sent/overdue with nothing paid -> void (frees the billing period)")

"""Quotation templates API.

RBAC
  anyone (catalogue) : list and read templates
  admin              : create templates (with their lines) and update them
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.current_user import CurrentUser, Role, require_roles
from app.repositories.quotation_template_repository import (
    QuotationTemplateRepository,
    get_quotation_template_repository,
)
from app.schemas.quotation_template import (
    QuotationTemplateCreate,
    QuotationTemplateResponse,
    QuotationTemplateUpdate,
)

router = APIRouter(prefix="/quotation-templates", tags=["quotation-templates"])

admin_only = require_roles(Role.ADMIN)
NOT_FOUND = "Quotation template not found"


def _require_plan(repo: QuotationTemplateRepository, plan_id: Optional[UUID]) -> None:
    if plan_id is None:
        return
    plan = repo.get_plan(plan_id)
    if not plan or plan.get("is_active") is False:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Plan not found or inactive")


@router.get("/", response_model=List[QuotationTemplateResponse])
def list_quotation_templates(
    is_active: Optional[bool] = Query(None),
    repo: QuotationTemplateRepository = Depends(get_quotation_template_repository),
):
    return repo.list_templates(is_active=is_active)


@router.post("/", response_model=QuotationTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_quotation_template(
    payload: QuotationTemplateCreate,
    user: CurrentUser = Depends(admin_only),
    repo: QuotationTemplateRepository = Depends(get_quotation_template_repository),
):
    # Validate every reference before writing anything.
    _require_plan(repo, payload.plan_id)
    for number, line in enumerate(payload.lines, start=1):
        product = repo.get_product(line.product_id)
        if not product or product.get("is_active") is False:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"Line {number}: product not found or inactive")
        if line.variant_id is not None:
            variant = repo.get_variant(line.variant_id)
            if (not variant or variant.get("is_active") is False
                    or str(variant["product_id"]) != str(line.product_id)):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    detail=f"Line {number}: variant not found for this product")

    template = repo.insert_template({
        "name": payload.name.strip(),
        "validity_days": payload.validity_days,
        "plan_id": payload.plan_id,
        "is_active": payload.is_active,
    })
    if payload.lines:
        try:
            repo.insert_lines([{
                "template_id": template["id"],
                "product_id": line.product_id,
                "variant_id": line.variant_id,
                "quantity": line.quantity,
            } for line in payload.lines])
        except Exception as exc:
            # Never leave a template without the lines it was created with.
            repo.delete_template(template["id"])
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="Could not save the template lines; nothing was created") from exc
    return repo.get_template(template["id"])


@router.get("/{template_id}", response_model=QuotationTemplateResponse)
def get_quotation_template(
    template_id: UUID,
    repo: QuotationTemplateRepository = Depends(get_quotation_template_repository),
):
    template = repo.get_template(template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return template


@router.patch("/{template_id}", response_model=QuotationTemplateResponse)
def update_quotation_template(
    template_id: UUID,
    payload: QuotationTemplateUpdate,
    user: CurrentUser = Depends(admin_only),
    repo: QuotationTemplateRepository = Depends(get_quotation_template_repository),
):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")
    if "name" in changes and changes["name"] is not None:
        changes["name"] = changes["name"].strip()
    _require_plan(repo, changes.get("plan_id"))
    if not repo.get_template(template_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    repo.update_template(template_id, changes)
    return repo.get_template(template_id)

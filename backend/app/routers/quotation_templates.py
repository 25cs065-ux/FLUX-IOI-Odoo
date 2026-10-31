from fastapi import APIRouter, HTTPException, Depends, status, Query
from typing import List, Optional
from app.schemas.quotation_template import (
    QuotationTemplateCreate,
    QuotationTemplateUpdate,
    QuotationTemplateResponse
)
from app.core.supabase import supabase
from app.core.auth import require_admin

router = APIRouter(
    prefix="/quotation-templates",
    tags=["quotation-templates"]
)

@router.get("/", response_model=List[QuotationTemplateResponse])
def list_quotation_templates(is_active: Optional[bool] = Query(None)):
    query = supabase.table("quotation_templates").select("*, quotation_template_lines(*)")
    if is_active is not None:
        query = query.eq("is_active", is_active)
    
    res = query.execute()
    data = res.data or []
    
    result = []
    for item in data:
        lines = item.pop("quotation_template_lines", []) or []
        item["lines"] = lines
        result.append(QuotationTemplateResponse(**item))
    return result

@router.post("/", response_model=QuotationTemplateResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_quotation_template(payload: QuotationTemplateCreate):
    for line in payload.lines:
        prod_res = supabase.table("products").select("id").eq("id", line.product_id).execute()
        if not prod_res.data or len(prod_res.data) == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with id '{line.product_id}' not found"
            )

    template_data = payload.model_dump(exclude={"lines"}, mode="json")
    res = supabase.table("quotation_templates").insert(template_data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create quotation template")
    
    new_template = res.data[0]
    template_id = new_template["id"]

    created_lines = []
    if payload.lines:
        lines_payload = []
        for line in payload.lines:
            line_dict = line.model_dump(mode="json")
            line_dict["template_id"] = template_id
            lines_payload.append(line_dict)
            
        line_res = supabase.table("quotation_template_lines").insert(lines_payload).execute()
        created_lines = line_res.data or []

    new_template["lines"] = created_lines
    return QuotationTemplateResponse(**new_template)

@router.get("/{template_id}", response_model=QuotationTemplateResponse)
def get_quotation_template(template_id: str):
    res = supabase.table("quotation_templates").select("*, quotation_template_lines(*)").eq("id", template_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation template not found")
    
    item = res.data[0]
    lines = item.pop("quotation_template_lines", []) or []
    item["lines"] = lines
    return QuotationTemplateResponse(**item)

@router.patch("/{template_id}", response_model=QuotationTemplateResponse, dependencies=[Depends(require_admin)])
def update_quotation_template(template_id: str, payload: QuotationTemplateUpdate):
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    res = supabase.table("quotation_templates").update(update_data).eq("id", template_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation template not found or update failed")
    
    return get_quotation_template(template_id)

from fastapi import APIRouter, HTTPException, Depends, status, Query
from typing import List, Optional
from datetime import datetime, timezone
from app.schemas.discount import DiscountCreate, DiscountUpdate, DiscountResponse
from app.core.supabase import supabase
from app.core.auth import require_admin

router = APIRouter(
    prefix="/discounts",
    tags=["discounts"]
)

@router.get("/", response_model=List[DiscountResponse], dependencies=[Depends(require_admin)])
def list_discounts(is_active: Optional[bool] = Query(None)):
    query = supabase.table("discounts").select("*")
    if is_active is not None:
        query = query.eq("is_active", is_active)
    
    res = query.execute()
    data = res.data or []
    return [DiscountResponse(**item) for item in data]

@router.post("/", response_model=DiscountResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_discount(payload: DiscountCreate):
    insert_data = payload.model_dump(mode="json")
    
    existing = supabase.table("discounts").select("id").eq("code", payload.code).execute()
    if existing.data and len(existing.data) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Discount code '{payload.code}' already exists"
        )

    res = supabase.table("discounts").insert(insert_data).execute()
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create discount record"
        )
    return DiscountResponse(**res.data[0])

@router.get("/{discount_id}", response_model=DiscountResponse, dependencies=[Depends(require_admin)])
def get_discount(discount_id: str):
    res = supabase.table("discounts").select("*").eq("id", discount_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found")
    return DiscountResponse(**res.data[0])

@router.patch("/{discount_id}", response_model=DiscountResponse, dependencies=[Depends(require_admin)])
def update_discount(discount_id: str, payload: DiscountUpdate):
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    # Combined date validation if either date is updated
    if payload.start_date is not None or payload.end_date is not None:
        current = supabase.table("discounts").select("*").eq("id", discount_id).execute()
        if not current.data or len(current.data) == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found")
        
        curr_item = current.data[0]
        effective_start = payload.start_date if payload.start_date is not None else (
            datetime.fromisoformat(curr_item["start_date"]) if curr_item.get("start_date") else None
        )
        effective_end = payload.end_date if payload.end_date is not None else (
            datetime.fromisoformat(curr_item["end_date"]) if curr_item.get("end_date") else None
        )

        if effective_start and effective_end and effective_end <= effective_start:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid dates: end_date must be strictly after start_date"
            )

    res = supabase.table("discounts").update(update_data).eq("id", discount_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found or update failed")
    return DiscountResponse(**res.data[0])

@router.post("/validate")
def validate_discount_code(code: str = Query(...), amount: float = Query(...), quantity: int = Query(1)):
    res = supabase.table("discounts").select("*").eq("code", code).eq("is_active", True).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or inactive discount code")
    
    discount = res.data[0]
    
    if amount < float(discount.get("min_purchase", 0.0)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum purchase amount of {discount['min_purchase']} required"
        )

    if quantity < int(discount.get("min_quantity", 1)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum quantity of {discount['min_quantity']} required"
        )

    limit = discount.get("usage_limit")
    count = int(discount.get("usage_count", 0))
    if limit is not None and count >= limit:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount usage limit reached")

    val = float(discount["value"])
    if discount["discount_type"] == "percentage":
        discounted_amount = amount * (val / 100.0)
    else:
        discounted_amount = min(val, amount)

    final_price = max(0.0, amount - discounted_amount)

    return {
        "code": code,
        "valid": True,
        "original_amount": round(amount, 2),
        "discount_applied": round(discounted_amount, 2),
        "final_amount": round(final_price, 2)
    }

from fastapi import APIRouter, HTTPException, Depends, status, Query
from typing import List, Optional
from app.schemas.variant import VariantCreate, VariantUpdate, VariantResponse
from app.core.supabase import supabase
from app.core.auth import require_admin

router = APIRouter(
    prefix="/variants",
    tags=["variants"]
)

def calculate_final_price(base_price: float, extra_price: float) -> float:
    if base_price < 0 or extra_price < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prices cannot be negative"
        )
    return round(base_price + extra_price, 2)

@router.get("/", response_model=List[VariantResponse])
def list_variants(product_id: Optional[str] = Query(None), is_active: Optional[bool] = Query(None)):
    query = supabase.table("variants").select("*")
    if product_id:
        query = query.eq("product_id", product_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    
    res = query.execute()
    data = res.data or []
    return [VariantResponse(**item) for item in data]

@router.post("/", response_model=VariantResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_variant(payload: VariantCreate):
    product_res = supabase.table("products").select("id, price").eq("id", payload.product_id).execute()
    if not product_res.data or len(product_res.data) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product with id '{payload.product_id}' not found"
        )

    base_price = float(product_res.data[0].get("price", 0.0))
    final_price = calculate_final_price(base_price, payload.extra_price)

    insert_data = payload.model_dump(mode="json")
    res = supabase.table("variants").insert(insert_data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create variant")
    
    item = res.data[0]
    item["calculated_price"] = final_price
    return VariantResponse(**item)

@router.get("/{variant_id}", response_model=VariantResponse)
def get_variant(variant_id: str):
    res = supabase.table("variants").select("*").eq("id", variant_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")
    
    variant = res.data[0]
    prod_res = supabase.table("products").select("price").eq("id", variant["product_id"]).execute()
    base_price = float(prod_res.data[0]["price"]) if prod_res.data else 0.0
    variant["calculated_price"] = calculate_final_price(base_price, float(variant.get("extra_price", 0.0)))
    return VariantResponse(**variant)

@router.patch("/{variant_id}", response_model=VariantResponse, dependencies=[Depends(require_admin)])
def update_variant(variant_id: str, payload: VariantUpdate):
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    res = supabase.table("variants").update(update_data).eq("id", variant_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found or update failed")
    
    return get_variant(variant_id)

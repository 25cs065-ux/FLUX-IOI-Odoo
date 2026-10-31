from fastapi import APIRouter, HTTPException, status, Query
from typing import List, Optional
from app.schemas.variant import VariantCreate, VariantUpdate, VariantResponse
from app.core.supabase import supabase

router = APIRouter(
    prefix="/variants",
    tags=["variants"]
)

def calculate_final_price(base_price: float, extra_price: float) -> float:
    return round(max(0.0, float(base_price)) + max(0.0, float(extra_price)), 2)

@router.get("/", response_model=List[VariantResponse])
def list_variants(product_id: Optional[str] = Query(None)):
    query = supabase.table("variants").select("*, products(price)")
    if product_id:
        query = query.eq("product_id", product_id)
    
    res = query.execute()
    data = res.data or []
    
    results = []
    for item in data:
        # Extract base price from joined products table if available
        product_data = item.get("products") or {}
        base_price = float(product_data.get("price", 0.0))
        extra_price = float(item.get("extra_price", 0.0))
        
        results.append(
            VariantResponse(
                id=str(item.get("id")),
                product_id=str(item.get("product_id")),
                name=item.get("name"),
                sku_suffix=item.get("sku_suffix"),
                extra_price=extra_price,
                base_product_price=base_price,
                final_price=calculate_final_price(base_price, extra_price),
                is_active=item.get("is_active", True),
                created_at=item.get("created_at")
            )
        )
    return results

@router.post("/", response_model=VariantResponse, status_code=status.HTTP_201_CREATED)
def create_variant(payload: VariantCreate):
    if payload.extra_price < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="extra_price must be greater than or equal to 0"
        )
    
    # Verify product exists and get its base price
    prod_res = supabase.table("products").select("price").eq("id", payload.product_id).execute()
    base_price = 0.0
    if prod_res.data and len(prod_res.data) > 0:
        base_price = float(prod_res.data[0].get("price", 0.0))
        
    insert_data = {
        "product_id": payload.product_id,
        "name": payload.name,
        "sku_suffix": payload.sku_suffix,
        "extra_price": payload.extra_price,
        "is_active": payload.is_active
    }
    
    res = supabase.table("variants").insert(insert_data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create variant")
    
    created = res.data[0]
    return VariantResponse(
        id=str(created.get("id")),
        product_id=str(created.get("product_id")),
        name=created.get("name"),
        sku_suffix=created.get("sku_suffix"),
        extra_price=float(created.get("extra_price", 0.0)),
        base_product_price=base_price,
        final_price=calculate_final_price(base_price, float(created.get("extra_price", 0.0))),
        is_active=created.get("is_active", True),
        created_at=created.get("created_at")
    )

@router.get("/{variant_id}", response_model=VariantResponse)
def get_variant(variant_id: str):
    res = supabase.table("variants").select("*, products(price)").eq("id", variant_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")
    
    item = res.data[0]
    product_data = item.get("products") or {}
    base_price = float(product_data.get("price", 0.0))
    extra_price = float(item.get("extra_price", 0.0))
    
    return VariantResponse(
        id=str(item.get("id")),
        product_id=str(item.get("product_id")),
        name=item.get("name"),
        sku_suffix=item.get("sku_suffix"),
        extra_price=extra_price,
        base_product_price=base_price,
        final_price=calculate_final_price(base_price, extra_price),
        is_active=item.get("is_active", True),
        created_at=item.get("created_at")
    )

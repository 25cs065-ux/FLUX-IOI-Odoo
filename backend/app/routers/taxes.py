from fastapi import APIRouter, HTTPException, Depends, status
from typing import List, Optional
from app.schemas.tax import TaxCreate, TaxUpdate, TaxResponse
from app.core.supabase import supabase
from app.core.auth import require_admin

router = APIRouter(
    prefix="/taxes",
    tags=["taxes"],
    dependencies=[Depends(require_admin)]
)

@router.get("/", response_model=List[TaxResponse])
def list_taxes(is_active: Optional[bool] = None):
    query = supabase.table("taxes").select("*")
    if is_active is not None:
        query = query.eq("is_active", is_active)
    
    res = query.execute()
    data = res.data or []
    return [TaxResponse(**item) for item in data]

@router.post("/", response_model=TaxResponse, status_code=status.HTTP_201_CREATED)
def create_tax(payload: TaxCreate):
    insert_data = payload.model_dump(mode="json")
    res = supabase.table("taxes").insert(insert_data).execute()
    
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create tax record"
        )
    return TaxResponse(**res.data[0])

@router.get("/{tax_id}", response_model=TaxResponse)
def get_tax(tax_id: str):
    res = supabase.table("taxes").select("*").eq("id", tax_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax not found")
    return TaxResponse(**res.data[0])

@router.patch("/{tax_id}", response_model=TaxResponse)
def update_tax(tax_id: str, payload: TaxUpdate):
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")
        
    res = supabase.table("taxes").update(update_data).eq("id", tax_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax not found or update failed")
    return TaxResponse(**res.data[0])

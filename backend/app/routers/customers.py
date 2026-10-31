from fastapi import APIRouter, HTTPException, Depends, Query, status
from typing import List, Optional
from datetime import datetime, timezone
import re

from app.schemas.customer import (
    CustomerCreate,
    CustomerUpdate,
    CustomerResponse
)
from app.core.supabase import supabase
from app.core.auth import get_current_user

router = APIRouter(prefix="/customers", tags=["Customers"])

def sanitize_search_query(term: str) -> str:
    # Strip PostgREST special control characters to prevent filter manipulation
    return re.sub(r"[,%()\"']", "", term).strip()

@router.post("/", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    current_user: dict = Depends(get_current_user)
):
    data = payload.model_dump(mode="json")
    if current_user.get("role") not in ("admin", "staff"):
        data["auth_user_id"] = current_user["id"]
        data["role"] = "customer"

    data["created_at"] = datetime.now(timezone.utc).isoformat()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = supabase.table("customers").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create customer")
    return CustomerResponse(**res.data[0])

@router.get("/", response_model=List[CustomerResponse])
def list_customers(
    search: Optional[str] = Query(None, max_length=100),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user)
):
    query = supabase.table("customers").select("*")

    # Enforce customer visibility boundary
    if current_user.get("role") not in ("admin", "staff"):
        query = query.eq("auth_user_id", current_user["id"])

    # Safe search handling
    if search:
        cleaned_term = sanitize_search_query(search)
        if cleaned_term:
            query = query.or_(f"name.ilike.%{cleaned_term}%,email.ilike.%{cleaned_term}%")

    # Pagination & Ordering
    res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return [CustomerResponse(**item) for item in (res.data or [])]

@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: str,
    current_user: dict = Depends(get_current_user)
):
    res = supabase.table("customers").select("*").eq("id", customer_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    record = res.data[0]
    if current_user.get("role") not in ("admin", "staff") and record.get("auth_user_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return CustomerResponse(**record)

@router.patch("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: str,
    payload: CustomerUpdate,
    current_user: dict = Depends(get_current_user)
):
    existing = supabase.table("customers").select("*").eq("id", customer_id).execute()
    if not existing.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    record = existing.data[0]
    if current_user.get("role") not in ("admin", "staff") and record.get("auth_user_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    # Prevent role escalation
    if current_user.get("role") not in ("admin", "staff") and "role" in update_data:
        del update_data["role"]

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = supabase.table("customers").update(update_data).eq("id", customer_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update customer")

    return CustomerResponse(**res.data[0])

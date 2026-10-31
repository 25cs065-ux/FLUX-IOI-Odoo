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
    return re.sub(r"[,%()\"']", "", term).strip()

@router.post("/", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    current_user: dict = Depends(get_current_user)
):
    is_staff = current_user.get("role") in ("admin", "staff")
    target_auth_id = payload.auth_user_id if is_staff else current_user["id"]

    # 1. Prevent duplicate profile creation by email or linked auth user
    existing_check = supabase.table("customers").select("id").or_(
        f"email.eq.{payload.email},auth_user_id.eq.{target_auth_id}"
    ).execute()
    if existing_check.data and len(existing_check.data) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A customer profile with this email or user ID already exists"
        )

    data = payload.model_dump(mode="json")
    if not is_staff:
        data["auth_user_id"] = current_user["id"]
        data["role"] = "customer"

    # Set created_at only; omitted updated_at to match live schema
    data["created_at"] = datetime.now(timezone.utc).isoformat()

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

    if current_user.get("role") not in ("admin", "staff"):
        query = query.eq("auth_user_id", current_user["id"])

    if search:
        cleaned_term = sanitize_search_query(search)
        if cleaned_term:
            query = query.or_(f"name.ilike.%{cleaned_term}%,email.ilike.%{cleaned_term}%")

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
    is_staff = current_user.get("role") in ("admin", "staff")

    if not is_staff and record.get("auth_user_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    # Prevent customers from changing role or deactivating their own account
    if not is_staff:
        if "role" in update_data:
            del update_data["role"]
        if "is_active" in update_data:
            del update_data["is_active"]

    # Do not set updated_at (column does not exist in live schema)

    res = supabase.table("customers").update(update_data).eq("id", customer_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update customer")

    return CustomerResponse(**res.data[0])

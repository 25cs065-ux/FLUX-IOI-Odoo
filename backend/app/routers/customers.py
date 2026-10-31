from fastapi import APIRouter, HTTPException, Depends, status
from typing import List, Optional
from datetime import datetime, timezone

from app.schemas.customer import (
    CustomerCreate,
    CustomerUpdate,
    CustomerResponse
)
from app.core.supabase import supabase
from app.core.auth import get_current_user, require_admin

router = APIRouter(prefix="/customers", tags=["Customers"])

@router.post("/", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    current_user: dict = Depends(get_current_user)
):
    # Only admin/staff or the authenticated user creating their own linked profile
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
def list_customers(current_user: dict = Depends(get_current_user)):
    # Non-admin/staff users only see their own customer profile
    query = supabase.table("customers").select("*")
    if current_user.get("role") not in ("admin", "staff"):
        query = query.eq("auth_user_id", current_user["id"])

    res = query.order("created_at", desc=True).execute()
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
    # Enforce owner/admin access
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
    # Enforce owner/admin access
    if current_user.get("role") not in ("admin", "staff") and record.get("auth_user_id") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    # Prevent customers from elevating their own role
    if current_user.get("role") not in ("admin", "staff") and "role" in update_data:
        del update_data["role"]

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = supabase.table("customers").update(update_data).eq("id", customer_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update customer")

    return CustomerResponse(**res.data[0])

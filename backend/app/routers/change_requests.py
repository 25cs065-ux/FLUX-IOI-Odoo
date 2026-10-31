from fastapi import APIRouter, HTTPException, Depends, status
from typing import List, Optional
from datetime import datetime, timezone

from app.schemas.change_request import (
    ChangeRequestCreate,
    ChangeRequestUpdate,
    ChangeRequestResponse,
    ChangeRequestStatus,
    TERMINAL_STATUSES
)
from app.core.supabase import supabase
from app.core.auth import get_current_user, require_admin

router = APIRouter(prefix="/change-requests", tags=["Change Requests"])

@router.post("/", response_model=ChangeRequestResponse, status_code=status.HTTP_201_CREATED)
def create_change_request(
    payload: ChangeRequestCreate,
    current_user: dict = Depends(get_current_user)
):
    data = payload.model_dump(mode="json")
    data["requested_by"] = current_user["id"]
    data["status"] = ChangeRequestStatus.PENDING.value
    data["created_at"] = datetime.now(timezone.utc).isoformat()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = supabase.table("change_requests").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create change request")
    return ChangeRequestResponse(**res.data[0])

@router.get("/", response_model=List[ChangeRequestResponse])
def list_change_requests(current_user: dict = Depends(get_current_user)):
    query = supabase.table("change_requests").select("*")
    if current_user.get("role") != "admin":
        query = query.eq("requested_by", current_user["id"])
    
    res = query.order("created_at", desc=True).execute()
    return [ChangeRequestResponse(**item) for item in (res.data or [])]

@router.get("/{request_id}", response_model=ChangeRequestResponse)
def get_change_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    res = supabase.table("change_requests").select("*").eq("id", request_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Change request not found")

    record = res.data[0]
    if current_user.get("role") != "admin" and record.get("requested_by") != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return ChangeRequestResponse(**record)

@router.patch("/{request_id}", response_model=ChangeRequestResponse)
def update_change_request_status(
    request_id: str,
    payload: ChangeRequestUpdate,
    admin_user: dict = Depends(require_admin)
):
    current = supabase.table("change_requests").select("*").eq("id", request_id).execute()
    if not current.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Change request not found")

    existing = current.data[0]
    curr_status = existing.get("status")

    if curr_status in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot modify change request already in terminal status '{curr_status}'"
        )

    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_data["reviewed_by"] = admin_user["id"]

    res = supabase.table("change_requests").update(update_data).eq("id", request_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update change request")

    return ChangeRequestResponse(**res.data[0])

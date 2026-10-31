from fastapi import APIRouter, HTTPException, Depends, status, Query
from typing import List, Optional
from datetime import datetime, date
from app.schemas.plan import PlanCreate, PlanUpdate, PlanResponse
from app.core.supabase import supabase
from app.core.auth import require_admin

router = APIRouter(
    prefix="/plans",
    tags=["plans"]
)

@router.get("/", response_model=List[PlanResponse])
def list_plans(is_active: Optional[bool] = Query(None)):
    query = supabase.table("plans").select("*")
    if is_active is not None:
        query = query.eq("is_active", is_active)
    
    res = query.execute()
    data = res.data or []
    return [PlanResponse(**item) for item in data]

@router.post("/", response_model=PlanResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_plan(payload: PlanCreate):
    insert_data = payload.model_dump(mode="json")
    res = supabase.table("plans").insert(insert_data).execute()
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Failed to create plan in database"
        )
    return PlanResponse(**res.data[0])

@router.get("/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: str):
    res = supabase.table("plans").select("*").eq("id", plan_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return PlanResponse(**res.data[0])

@router.patch("/{plan_id}", response_model=PlanResponse, dependencies=[Depends(require_admin)])
def update_plan(plan_id: str, payload: PlanUpdate):
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    current = supabase.table("plans").select("*").eq("id", plan_id).execute()
    if not current.data or len(current.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    existing_plan = current.data[0]
    
    def parse_dt(val):
        if not val:
            return None
        if isinstance(val, (date, datetime)):
            return val
        return datetime.fromisoformat(str(val)).date()

    effective_start = payload.start_date if payload.start_date is not None else parse_dt(existing_plan.get("start_date"))
    effective_end = payload.end_date if payload.end_date is not None else parse_dt(existing_plan.get("end_date"))

    if effective_start and effective_end and effective_end <= effective_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid dates: end_date must be strictly after start_date"
        )

    res = supabase.table("plans").update(update_data).eq("id", plan_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Update failed")
    return PlanResponse(**res.data[0])

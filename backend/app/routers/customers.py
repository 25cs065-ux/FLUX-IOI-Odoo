from fastapi import APIRouter, HTTPException, Depends, status, Query
from typing import List, Optional
from app.schemas.customer import CustomerCreate, CustomerUpdate, CustomerResponse, StaffCreate, UserRole
from app.core.supabase import supabase
from app.core.auth import require_admin

router = APIRouter(
    prefix="/customers",
    tags=["customers"]
)

@router.get("/", response_model=List[CustomerResponse])
def list_customers(
    search: Optional[str] = Query(None, description="Search by name or email"),
    role: Optional[UserRole] = Query(None),
    is_active: Optional[bool] = Query(None)
):
    query = supabase.table("customers").select("*")
    if role:
        query = query.eq("role", role.value)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    if search:
        query = query.or_(f"name.ilike.%{search}%,email.ilike.%{search}%")
        
    res = query.execute()
    data = res.data or []
    return [CustomerResponse(**item) for item in data]

@router.post("/", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate):
    existing = supabase.table("customers").select("id").eq("email", payload.email).execute()
    if existing.data and len(existing.data) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Customer with email '{payload.email}' already exists"
        )
    
    insert_data = payload.model_dump(mode="json")
    insert_data["role"] = UserRole.CUSTOMER.value
    
    res = supabase.table("customers").insert(insert_data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create customer")
    return CustomerResponse(**res.data[0])

@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(customer_id: str):
    res = supabase.table("customers").select("*").eq("id", customer_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return CustomerResponse(**res.data[0])

@router.patch("/{customer_id}", response_model=CustomerResponse)
def update_customer(customer_id: str, payload: CustomerUpdate):
    update_data = payload.model_dump(exclude_unset=True, mode="json")
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update")

    res = supabase.table("customers").update(update_data).eq("id", customer_id).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found or update failed")
    return CustomerResponse(**res.data[0])

@router.post("/staff", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_staff(payload: StaffCreate):
    existing = supabase.table("customers").select("id").eq("email", payload.email).execute()
    if existing.data and len(existing.data) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email '{payload.email}' already exists"
        )

    insert_data = {
        "name": payload.name,
        "email": payload.email,
        "role": payload.role.value,
        "is_active": True
    }
    
    res = supabase.table("customers").insert(insert_data).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create staff member")
    return CustomerResponse(**res.data[0])

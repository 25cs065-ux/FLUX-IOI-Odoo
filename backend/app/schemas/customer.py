from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional
from datetime import datetime

class CustomerBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Customer full name or company name")
    email: EmailStr = Field(..., description="Customer primary email address")
    phone: Optional[str] = Field(None, max_length=20, description="Contact phone number")
    address: Optional[str] = Field(None, max_length=255, description="Billing/physical address")
    auth_user_id: Optional[str] = Field(None, description="Linked Supabase auth.users UUID")

class CustomerCreate(CustomerBase):
    role: Optional[str] = Field("customer", description="User role: customer, staff, or admin")
    is_active: Optional[bool] = Field(True, description="Account active status")

class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = Field(None, max_length=255)
    role: Optional[str] = None
    is_active: Optional[bool] = None

class CustomerResponse(CustomerBase):
    id: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

import re
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional
from datetime import datetime
from enum import Enum

EMAIL_REGEX = r"^[\w\.-]+@[\w\.-]+\.\w+$"

class UserRole(str, Enum):
    CUSTOMER = "customer"
    STAFF = "staff"
    ADMIN = "admin"

class CustomerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(...)
    is_active: bool = True

    @field_validator("email")
    @classmethod
    def validate_email_pattern(cls, v: str) -> str:
        if not re.match(EMAIL_REGEX, v):
            raise ValueError("Invalid email format")
        return v.lower()

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None

class CustomerResponse(CustomerBase):
    id: str
    auth_user_id: Optional[str] = None
    role: UserRole
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class StaffCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(...)
    password: str = Field(..., description="Password must be strictly greater than 8 characters")
    role: UserRole = UserRole.STAFF

    @field_validator("email")
    @classmethod
    def validate_email_pattern(cls, v: str) -> str:
        if not re.match(EMAIL_REGEX, v):
            raise ValueError("Invalid email format")
        return v.lower()

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, v: str) -> str:
        if len(v) <= 8:
            raise ValueError("Password must be strictly greater than 8 characters")
        return v

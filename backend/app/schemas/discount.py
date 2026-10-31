from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional
from datetime import datetime
from enum import Enum

class DiscountType(str, Enum):
    FIXED = "fixed"
    PERCENTAGE = "percentage"

class AppliesTo(str, Enum):
    PRODUCT = "product"
    SUBSCRIPTION = "subscription"

class DiscountBase(BaseModel):
    code: str = Field(..., min_length=2, max_length=50, description="Unique discount coupon code")
    discount_type: DiscountType
    value: float = Field(..., ge=0.0, description="Discount amount or percentage")
    min_purchase: float = Field(default=0.0, ge=0.0, description="Minimum order purchase value")
    min_quantity: int = Field(default=1, ge=1, description="Minimum item quantity required")
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    usage_limit: Optional[int] = Field(None, ge=1, description="Max total usage count allowed")
    usage_count: int = Field(default=0, ge=0)
    applies_to: AppliesTo
    target_id: Optional[str] = Field(None, description="UUID of target product or subscription plan if scoped")
    is_active: bool = True

    @model_validator(mode="after")
    def validate_discount_rules(self):
        if self.discount_type == DiscountType.PERCENTAGE and self.value > 100.0:
            raise ValueError("Percentage discount value cannot exceed 100%")
            
        if self.start_date and self.end_date:
            if self.end_date <= self.start_date:
                raise ValueError("end_date must be strictly after start_date")
        return self

class DiscountCreate(DiscountBase):
    pass

class DiscountUpdate(BaseModel):
    code: Optional[str] = Field(None, min_length=2, max_length=50)
    discount_type: Optional[DiscountType] = None
    value: Optional[float] = Field(None, ge=0.0)
    min_purchase: Optional[float] = Field(None, ge=0.0)
    min_quantity: Optional[int] = Field(None, ge=1)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    usage_limit: Optional[int] = Field(None, ge=1)
    usage_count: Optional[int] = Field(None, ge=0)
    applies_to: Optional[AppliesTo] = None
    target_id: Optional[str] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def validate_discount_rules(self):
        if self.discount_type == DiscountType.PERCENTAGE and self.value is not None and self.value > 100.0:
            raise ValueError("Percentage discount value cannot exceed 100%")
        if self.start_date and self.end_date:
            if self.end_date <= self.start_date:
                raise ValueError("end_date must be strictly after start_date")
        return self

class DiscountResponse(DiscountBase):
    id: str
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

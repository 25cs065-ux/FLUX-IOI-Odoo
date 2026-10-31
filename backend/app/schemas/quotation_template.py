from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import List, Optional
from datetime import datetime

class TemplateLineBase(BaseModel):
    product_id: str = Field(..., description="Target product UUID")
    variant_id: Optional[str] = Field(None, description="Optional variant UUID")
    quantity: int = Field(default=1, ge=1, description="Quantity must be at least 1")
    unit_price: float = Field(..., ge=0.0, description="Unit price cannot be negative")
    discount_percentage: float = Field(default=0.0, ge=0.0, le=100.0, description="Line discount 0-100%")

class TemplateLineCreate(TemplateLineBase):
    pass

class TemplateLineResponse(TemplateLineBase):
    id: str
    template_id: str

    model_config = ConfigDict(from_attributes=True)

class QuotationTemplateBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150, description="Template title")
    validity_days: int = Field(default=30, ge=1, description="Quote validity period in days")
    terms_and_conditions: Optional[str] = Field(None, max_length=2000)
    is_active: bool = True

class QuotationTemplateCreate(QuotationTemplateBase):
    lines: List[TemplateLineCreate] = Field(default=[], description="Preset line items")

class QuotationTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    validity_days: Optional[int] = Field(None, ge=1)
    terms_and_conditions: Optional[str] = Field(None, max_length=2000)
    is_active: Optional[bool] = None

class QuotationTemplateResponse(QuotationTemplateBase):
    id: str
    lines: List[TemplateLineResponse] = []
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

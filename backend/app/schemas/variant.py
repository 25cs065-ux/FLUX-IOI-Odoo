from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime

class VariantBase(BaseModel):
    product_id: str = Field(..., description="UUID or ID of the parent product")
    name: str = Field(..., min_length=1, max_length=100, description="e.g. Enterprise, Pro, Edition")
    sku_suffix: Optional[str] = Field(None, max_length=50)
    extra_price: float = Field(default=0.0, ge=0.0, description="Surcharge, must be >= 0")
    is_active: bool = True

class VariantCreate(VariantBase):
    pass

class VariantUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    sku_suffix: Optional[str] = Field(None, max_length=50)
    extra_price: Optional[float] = Field(None, ge=0.0)
    is_active: Optional[bool] = None

class VariantResponse(VariantBase):
    id: str
    base_product_price: float = 0.0
    final_price: float = 0.0
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

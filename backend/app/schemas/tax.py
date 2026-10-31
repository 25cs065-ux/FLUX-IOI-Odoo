from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime

class TaxBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Tax name, e.g., GST 18%")
    rate: float = Field(..., ge=0.0, le=100.0, description="Percentage rate between 0 and 100")
    rule: Optional[str] = Field(None, max_length=255, description="Rule description or applicability")
    is_active: bool = True

class TaxCreate(TaxBase):
    pass

class TaxUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    rate: Optional[float] = Field(None, ge=0.0, le=100.0)
    rule: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None

class TaxResponse(TaxBase):
    id: str
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

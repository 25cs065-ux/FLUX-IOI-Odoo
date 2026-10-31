from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional
from datetime import datetime, date
from enum import Enum

class PlanInterval(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"

class PlanBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    interval: PlanInterval
    price: float = Field(..., ge=0.0, description="Plan price must be >= 0")
    min_quantity: int = Field(default=1, ge=1, description="Minimum quantity must be >= 1")
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    auto_close: bool = False
    closable_early: bool = True
    pausable: bool = True
    renewable: bool = True
    is_active: bool = True

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date and self.end_date:
            if self.end_date <= self.start_date:
                raise ValueError("end_date must be strictly after start_date")
        return self

class PlanCreate(PlanBase):
    pass

class PlanUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    interval: Optional[PlanInterval] = None
    price: Optional[float] = Field(None, ge=0.0)
    min_quantity: Optional[int] = Field(None, ge=1)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    auto_close: Optional[bool] = None
    closable_early: Optional[bool] = None
    pausable: Optional[bool] = None
    renewable: Optional[bool] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date and self.end_date:
            if self.end_date <= self.start_date:
                raise ValueError("end_date must be strictly after start_date")
        return self

class PlanResponse(PlanBase):
    id: str
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

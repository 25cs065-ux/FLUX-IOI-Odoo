"""Quotation template schemas, matching the live tables:

    quotation_templates      id, name (required), plan_id -> plans.id, validity_days (default 30),
                             is_active (default true), created_at
    quotation_template_lines id, template_id -> quotation_templates.id, product_id -> products.id
                             (required), variant_id -> variants.id, quantity (default 1)

The live tables have no terms-and-conditions column and no per-line price or
discount, so the API does not accept them: line prices come from the product
and variant when a quotation is created from the template.
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TemplateLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID = Field(..., description="Product on this line")
    variant_id: Optional[UUID] = Field(None, description="Optional variant of that product")
    quantity: int = Field(default=1, ge=1, le=100000)


class TemplateLineResponse(BaseModel):
    id: UUID
    template_id: UUID
    product_id: UUID
    variant_id: Optional[UUID] = None
    quantity: int
    product_name: Optional[str] = None
    variant_name: Optional[str] = None


class QuotationTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=2, max_length=150, description="Template title")
    validity_days: int = Field(default=30, ge=1, le=3650, description="Quote validity period in days")
    plan_id: Optional[UUID] = Field(None, description="Optional recurring plan the quotation uses")
    is_active: bool = True
    lines: List[TemplateLineCreate] = Field(default_factory=list, max_length=50,
                                            description="Preset product lines")


class QuotationTemplateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(None, min_length=2, max_length=150)
    validity_days: Optional[int] = Field(None, ge=1, le=3650)
    plan_id: Optional[UUID] = None
    is_active: Optional[bool] = None


class QuotationTemplateResponse(BaseModel):
    id: UUID
    name: str
    validity_days: int
    plan_id: Optional[UUID] = None
    plan_name: Optional[str] = None
    is_active: bool
    lines: List[TemplateLineResponse] = []
    created_at: Optional[datetime] = None

"""Pydantic models for subscriptions (table: subscriptions, subscription_lines,
subscription_status_history in database/remaining_schema.sql)."""
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Money = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
Quantity = Annotated[Decimal, Field(ge=1, max_digits=12, decimal_places=4)]
Percent = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
Currency = Annotated[str, Field(min_length=3, max_length=3, pattern="^[A-Z]{3}$")]


class SubscriptionStatus(str, Enum):
    DRAFT = "draft"
    QUOTATION = "quotation"
    CONFIRMED = "confirmed"
    ACTIVE = "active"
    PAUSED = "paused"
    CLOSED = "closed"


def _check_dates(start: Optional[date], end: Optional[date], trial_end: Optional[date]):
    if start and end and end <= start:
        raise ValueError("end_date must be strictly after start_date")
    if start and trial_end and trial_end < start:
        raise ValueError("trial_end_date cannot be before start_date")
    if end and trial_end and trial_end > end:
        raise ValueError("trial_end_date cannot be after end_date")


# ---------------------------------------------------------------- lines

class SubscriptionLineInput(BaseModel):
    """A line item. With a product, description and unit_price default to the
    product name / price (+ variant extra_price). Without one, both are required."""
    model_config = ConfigDict(extra="forbid")

    product_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    quantity: Quantity = Decimal("1")
    unit_price: Optional[Money] = None
    discount_percent: Percent = Decimal("0")
    tax_id: Optional[UUID] = None
    sequence: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def require_product_or_manual_price(self):
        if self.product_id is None and self.variant_id is None:
            if self.description is None or self.unit_price is None:
                raise ValueError(
                    "description and unit_price are required when no product_id/variant_id is given"
                )
        return self


class SubscriptionLineResponse(BaseModel):
    id: UUID
    subscription_id: UUID
    product_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None
    sequence: int
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_percent: Decimal
    discount_amount: Decimal
    tax_id: Optional[UUID] = None
    tax_amount: Decimal
    subtotal: Decimal
    line_total: Decimal
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ---------------------------------------------------------------- subscriptions

class SubscriptionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: UUID
    plan_id: UUID
    quantity: Quantity = Decimal("1")
    start_date: date
    end_date: Optional[date] = Field(None, description="Leave empty for an open-ended subscription")
    trial_end_date: Optional[date] = None
    payment_terms_id: Optional[UUID] = None
    quotation_template_id: Optional[UUID] = None
    currency: Currency = "INR"
    auto_renew: bool = True
    notes: Optional[str] = Field(None, max_length=2000)
    lines: List[SubscriptionLineInput] = Field(
        default_factory=list,
        description="If empty, one line is created from the plan (plan price x quantity)",
    )

    @model_validator(mode="after")
    def validate_dates(self):
        _check_dates(self.start_date, self.end_date, self.trial_end_date)
        return self


class SubscriptionUpdate(BaseModel):
    """Partial update. Only notes and auto_renew can change after confirmation;
    everything else is editable in draft / quotation only. Sending `lines`
    replaces all existing lines."""
    model_config = ConfigDict(extra="forbid")

    plan_id: Optional[UUID] = None
    quantity: Optional[Quantity] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    trial_end_date: Optional[date] = None
    payment_terms_id: Optional[UUID] = None
    quotation_template_id: Optional[UUID] = None
    currency: Optional[Currency] = None
    auto_renew: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=2000)
    lines: Optional[List[SubscriptionLineInput]] = None

    @model_validator(mode="after")
    def validate_dates(self):
        _check_dates(self.start_date, self.end_date, self.trial_end_date)
        return self


class SubscriptionSummary(BaseModel):
    id: UUID
    subscription_number: str
    quotation_number: Optional[str] = None
    customer_id: UUID
    plan_id: UUID
    quotation_template_id: Optional[UUID] = None
    payment_terms_id: Optional[UUID] = None
    status: SubscriptionStatus
    quantity: Decimal
    start_date: date
    end_date: Optional[date] = None
    trial_end_date: Optional[date] = None
    next_billing_date: Optional[date] = None
    confirmed_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    pause_reason: Optional[str] = None
    closed_at: Optional[datetime] = None
    close_reason: Optional[str] = None
    unit_price: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    currency: str
    auto_renew: bool
    notes: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SubscriptionDetail(SubscriptionSummary):
    lines: List[SubscriptionLineResponse] = []


class StatusHistoryResponse(BaseModel):
    id: UUID
    subscription_id: UUID
    from_status: Optional[str] = None
    to_status: str
    changed_by: Optional[UUID] = None
    reason: Optional[str] = None
    metadata: dict[str, Any] = {}
    changed_at: Optional[datetime] = None


# ---------------------------------------------------------------- lifecycle actions

class ReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Optional[str] = Field(None, max_length=1000)


class RenewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_end_date: Optional[date] = Field(
        None, description="Defaults to extending by the current term length (end_date - start_date)"
    )
    reason: Optional[str] = Field(None, max_length=1000)

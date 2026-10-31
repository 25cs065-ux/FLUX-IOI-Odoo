"""Pydantic models for payments (table: payments in database/remaining_schema.sql)."""
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.invoice import InvoiceSummary
from app.schemas.subscription import Currency

PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]


class PaymentMethod(str, Enum):
    BANK_TRANSFER = "bank_transfer"
    CREDIT_CARD = "credit_card"
    UPI = "upi"
    CASH = "cash"
    CHEQUE = "cheque"
    OTHER = "other"


class PaymentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"


class PaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_id: UUID
    amount: PositiveMoney
    method: PaymentMethod = PaymentMethod.BANK_TRANSFER
    status: Literal["completed", "pending"] = Field(
        "completed", description="Use 'pending' for gateway payments awaiting confirmation"
    )
    payment_date: Optional[date] = Field(None, description="Defaults to today; cannot be in the future")
    payment_reference: Optional[str] = Field(
        None, min_length=1, max_length=100,
        description="Idempotency key. Re-sending the same reference returns the original payment "
                    "instead of recording it twice. Generated when omitted.",
    )
    currency: Optional[Currency] = Field(None, description="Must match the invoice currency")
    gateway: Optional[str] = Field(None, max_length=50)
    gateway_payment_id: Optional[str] = Field(None, max_length=200)
    gateway_response: dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = Field(None, max_length=2000)


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Optional[PositiveMoney] = Field(None, description="Defaults to the full refundable amount")
    reason: Optional[str] = Field(None, max_length=1000)


class PaymentResponse(BaseModel):
    id: UUID
    payment_reference: str
    invoice_id: UUID
    customer_id: UUID
    method: PaymentMethod
    status: PaymentStatus
    amount: Decimal
    currency: str
    payment_date: date
    gateway: Optional[str] = None
    gateway_payment_id: Optional[str] = None
    gateway_response: dict[str, Any] = {}
    refunded_amount: Decimal
    refunded_at: Optional[datetime] = None
    notes: Optional[str] = None
    recorded_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PaymentResult(BaseModel):
    """A payment together with the invoice balance it produced."""
    payment: PaymentResponse
    invoice: InvoiceSummary

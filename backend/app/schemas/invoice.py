"""Pydantic models for invoices (tables: invoices, invoice_lines in
database/remaining_schema.sql)."""
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.subscription import Currency, SubscriptionLineInput

# Same shape and defaults as subscription lines (product/variant price lookup).
InvoiceLineInput = SubscriptionLineInput


class InvoiceStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"
    VOID = "void"
    CANCELLED = "cancelled"


def _check_dates(issue: Optional[date], due: Optional[date]):
    if issue and due and due < issue:
        raise ValueError("due_date cannot be before issue_date")


class InvoiceCreate(BaseModel):
    """Manual (ad-hoc) invoice. Use POST /invoices/generate for subscription billing."""
    model_config = ConfigDict(extra="forbid")

    customer_id: UUID
    subscription_id: Optional[UUID] = Field(None, description="Optional link; must belong to the customer")
    payment_terms_id: Optional[UUID] = None
    issue_date: Optional[date] = Field(None, description="Defaults to today")
    due_date: Optional[date] = Field(None, description="Defaults to issue_date + payment terms days_due")
    currency: Currency = "INR"
    notes: Optional[str] = Field(None, max_length=2000)
    terms_and_conditions: Optional[str] = Field(None, max_length=10000)
    lines: List[InvoiceLineInput] = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_dates(self):
        _check_dates(self.issue_date, self.due_date)
        return self


class InvoiceGenerate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subscription_id: UUID
    issue_date: Optional[date] = Field(None, description="Defaults to today")


class BillingRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    as_of: Optional[date] = Field(None, description="Bill every period starting on or before this date (default today)")


class InvoiceUpdate(BaseModel):
    """Everything is editable in draft. Afterwards only notes. Sending `lines`
    replaces all lines and re-prices the invoice."""
    model_config = ConfigDict(extra="forbid")

    payment_terms_id: Optional[UUID] = None
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=2000)
    terms_and_conditions: Optional[str] = Field(None, max_length=10000)
    lines: Optional[List[InvoiceLineInput]] = Field(None, min_length=1)

    @model_validator(mode="after")
    def validate_dates(self):
        _check_dates(self.issue_date, self.due_date)
        return self


class InvoiceLineResponse(BaseModel):
    id: UUID
    invoice_id: UUID
    subscription_line_id: Optional[UUID] = None
    product_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None
    sequence: int
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_percent: Decimal
    discount_amount: Decimal
    tax_id: Optional[UUID] = None
    tax_name: Optional[str] = None
    tax_rate: Optional[Decimal] = None
    tax_amount: Decimal
    subtotal: Decimal
    line_total: Decimal
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class InvoiceSummary(BaseModel):
    id: UUID
    invoice_number: str
    subscription_id: Optional[UUID] = None
    customer_id: UUID
    payment_terms_id: Optional[UUID] = None
    discount_id: Optional[UUID] = None
    status: InvoiceStatus
    issue_date: date
    due_date: date
    billing_period_start: Optional[date] = None
    billing_period_end: Optional[date] = None
    subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    amount_paid: Decimal
    amount_due: Decimal
    currency: str
    tax_name: Optional[str] = None
    tax_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    sent_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    voided_at: Optional[datetime] = None
    created_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class InvoiceDetail(InvoiceSummary):
    lines: List[InvoiceLineResponse] = []


class BillingRunIssue(BaseModel):
    subscription_id: UUID
    reason: str


class BillingRunResult(BaseModel):
    created: List[InvoiceSummary]
    recovered: List[BillingRunIssue] = Field(
        description="Periods already invoiced by an earlier, interrupted run; next_billing_date was advanced")
    skipped: List[BillingRunIssue] = Field(description="Refused by a business rule (e.g. no lines to invoice)")
    failed: List[BillingRunIssue] = Field(
        description="Unexpected errors; the run continued with the other subscriptions")


class OverdueRunResult(BaseModel):
    marked_overdue: List[UUID]

"""Change request schemas, matching the live public.change_requests table:

    id uuid PK, customer_id uuid NOT NULL -> customers.id, subscription_id uuid,
    request_type text NOT NULL, details text, status text DEFAULT 'pending',
    created_at / updated_at timestamptz DEFAULT now()
"""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChangeRequestStatus(str, Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    APPLIED = "applied"


TERMINAL_STATUSES = {ChangeRequestStatus.APPROVED.value, ChangeRequestStatus.REJECTED.value,
                     ChangeRequestStatus.APPLIED.value}


class ChangeRequestType(str, Enum):
    UPGRADE = "upgrade"
    DOWNGRADE = "downgrade"
    QUANTITY_CHANGE = "quantity_change"
    CANCELLATION = "cancellation"
    OTHER = "other"


class ChangeRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: Optional[UUID] = Field(
        None, description="Required for admin/staff; ignored for customers (always their own)")
    subscription_id: Optional[UUID] = Field(None, description="Subscription the request is about")
    request_type: ChangeRequestType
    details: str = Field(..., min_length=10, max_length=1000,
                         description="What the customer wants changed and why")


class ChangeRequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ChangeRequestStatus


class ChangeRequestResponse(BaseModel):
    id: UUID
    customer_id: UUID
    subscription_id: Optional[UUID] = None
    request_type: str
    details: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

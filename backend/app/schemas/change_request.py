from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional, Dict, Any
from datetime import datetime
from enum import Enum

class ChangeRequestStatus(str, Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    APPLIED = "applied"

TERMINAL_STATUSES = {ChangeRequestStatus.APPROVED.value, ChangeRequestStatus.REJECTED.value, ChangeRequestStatus.APPLIED.value}

class ChangeRequestBase(BaseModel):
    quotation_id: str = Field(..., description="UUID of target quotation")
    requested_by: Optional[str] = Field(None, description="Customer or Staff user ID making request")
    reason: str = Field(..., min_length=10, max_length=500, description="Detailed explanation of requested changes")
    proposed_changes: Optional[Dict[str, Any]] = Field(default_factory=dict, description="JSON dictionary of requested alterations")

class ChangeRequestCreate(ChangeRequestBase):
    pass

class ChangeRequestUpdate(BaseModel):
    status: Optional[ChangeRequestStatus] = None
    reviewer_notes: Optional[str] = Field(None, max_length=500)
    rejection_reason: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_rejection_reason(self):
        if self.status == ChangeRequestStatus.REJECTED and not self.rejection_reason:
            raise ValueError("rejection_reason is required when rejecting a change request")
        return self

class ChangeRequestResponse(ChangeRequestBase):
    id: str
    status: ChangeRequestStatus
    reviewer_notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    reviewed_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

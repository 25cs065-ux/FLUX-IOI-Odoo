import pytest
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.change_request import (
    ChangeRequestCreate,
    ChangeRequestUpdate,
    ChangeRequestStatus
)
from app.routers.change_requests import router as change_requests_router
from app.core.auth import get_current_user, require_admin

test_app = FastAPI()
test_app.include_router(change_requests_router)
client = TestClient(test_app)

DUMMY_UUID = "00000000-0000-0000-0000-000000000000"

def test_valid_change_request_creation_schema():
    cr = ChangeRequestCreate(
        quotation_id="qt-001",
        reason="Need 2 extra licenses added",
        proposed_changes={"quantity": 5}
    )
    assert cr.quotation_id == "qt-001"
    assert cr.reason == "Need 2 extra licenses added"

def test_short_reason_fails():
    with pytest.raises(ValidationError):
        ChangeRequestCreate(
            quotation_id="qt-001",
            reason="Tiny"
        )

def test_reject_status_without_reason_fails():
    with pytest.raises(ValidationError):
        ChangeRequestUpdate(
            status=ChangeRequestStatus.REJECTED,
            rejection_reason=""
        )

def test_reject_status_with_valid_reason_passes():
    update = ChangeRequestUpdate(
        status=ChangeRequestStatus.REJECTED,
        rejection_reason="Item is out of stock in regional warehouse"
    )
    assert update.status == ChangeRequestStatus.REJECTED

def test_unauthenticated_requests_blocked():
    assert client.get("/change-requests/").status_code == 401
    assert client.get(f"/change-requests/{DUMMY_UUID}").status_code == 401
    assert client.post("/change-requests/", json={"quotation_id": "q1", "reason": "Need changes"}).status_code == 401
    assert client.patch(f"/change-requests/{DUMMY_UUID}", json={"status": "approved"}).status_code == 401

def test_customer_cannot_view_other_user_request():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "user-A", "email": "a@test.com", "role": "customer"}
    with patch("app.routers.change_requests.supabase") as mock_sb:
        mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": DUMMY_UUID,
            "quotation_id": "qt-001",
            "requested_by": "user-B",
            "reason": "Need 2 extra licenses added",
            "proposed_changes": {"quantity": 5},
            "status": "pending",
            "created_at": "2026-10-31T00:00:00Z",
            "updated_at": "2026-10-31T00:00:00Z"
        }]
        res = client.get(f"/change-requests/{DUMMY_UUID}")
        assert res.status_code == 403
    test_app.dependency_overrides.clear()

def test_status_update_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "c@test.com", "role": "customer"}
    try:
        res = client.patch(f"/change-requests/{DUMMY_UUID}", json={"status": "approved", "reviewer_notes": "ok"})
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.change_requests.supabase")
def test_status_update_permits_admin_and_sets_reviewed_by(mock_supabase):
    admin_data = {"id": "admin-999", "email": "admin@test.com", "role": "admin"}
    test_app.dependency_overrides[get_current_user] = lambda: admin_data
    test_app.dependency_overrides[require_admin] = lambda: admin_data

    mock_record = {
        "id": DUMMY_UUID,
        "quotation_id": "qt-001",
        "requested_by": "usr-123",
        "reason": "Need 2 extra licenses added",
        "proposed_changes": {"quantity": 5},
        "status": "pending",
        "created_at": "2026-10-31T00:00:00Z",
        "updated_at": "2026-10-31T00:00:00Z"
    }

    mock_updated_record = {
        **mock_record,
        "status": "under_review",
        "reviewer_notes": "Reviewing now",
        "reviewed_by": "admin-999"
    }

    mock_table = MagicMock()
    mock_table.select.return_value.eq.return_value.execute.return_value.data = [mock_record]
    mock_table.update.return_value.eq.return_value.execute.return_value.data = [mock_updated_record]
    mock_supabase.table.return_value = mock_table

    try:
        payload = {"status": "under_review", "reviewer_notes": "Reviewing now"}
        res = client.patch(f"/change-requests/{DUMMY_UUID}", json=payload)
        assert res.status_code == 200
        assert res.json()["status"] == "under_review"
        called_update_payload = mock_table.update.call_args[0][0]
        assert called_update_payload["reviewed_by"] == "admin-999"
    finally:
        test_app.dependency_overrides.clear()

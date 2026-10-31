import pytest
from unittest.mock import patch, MagicMock
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.quotation_template import (
    QuotationTemplateCreate,
    QuotationTemplateLineCreate
)
from app.routers.quotation_templates import router as quotation_templates_router
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(quotation_templates_router)
client = TestClient(test_app)

def test_valid_template_creation():
    tmpl = QuotationTemplateCreate(
        name="Enterprise Proposal",
        validity_days=30,
        description="Standard template for B2B deals"
    )
    assert tmpl.name == "Enterprise Proposal"
    assert tmpl.validity_days == 30

def test_negative_validity_days_fails():
    with pytest.raises(ValidationError):
        QuotationTemplateCreate(
            name="Invalid Template",
            validity_days=-5
        )

def test_zero_validity_days_fails():
    with pytest.raises(ValidationError):
        QuotationTemplateCreate(
            name="Zero Days",
            validity_days=0
        )

def test_valid_line_creation():
    line = QuotationTemplateLineCreate(
        product_id="prod-001",
        quantity=5,
        unit_price=50.0,
        discount=10.0
    )
    assert line.quantity == 5
    assert line.unit_price == 50.0
    assert line.discount == 10.0

def test_negative_quantity_line_fails():
    with pytest.raises(ValidationError):
        QuotationTemplateLineCreate(
            product_id="prod-001",
            quantity=-1,
            unit_price=50.0
        )

def test_negative_unit_price_line_fails():
    with pytest.raises(ValidationError):
        QuotationTemplateLineCreate(
            product_id="prod-001",
            quantity=1,
            unit_price=-10.0
        )

def test_template_creation_blocks_unauthenticated():
    payload = {
        "name": "Standard Deal",
        "validity_days": 15
    }
    res = client.post("/quotation-templates/", json=payload)
    assert res.status_code == 401

def test_template_creation_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "cust@test.com", "role": "customer"}
    try:
        payload = {
            "name": "Standard Deal",
            "validity_days": 15
        }
        res = client.post("/quotation-templates/", json=payload)
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

@patch("app.routers.quotation_templates.supabase")
def test_template_creation_permits_admin(mock_supabase):
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "a1", "email": "admin@test.com", "role": "admin"}
    
    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value.data = [{
        "id": "00000000-0000-0000-0000-000000000000",
        "name": "Admin Template",
        "validity_days": 45,
        "description": "Special Enterprise",
        "created_at": "2026-10-31T00:00:00Z"
    }]
    mock_supabase.table.return_value = mock_table

    try:
        payload = {
            "name": "Admin Template",
            "validity_days": 45,
            "description": "Special Enterprise"
        }
        res = client.post("/quotation-templates/", json=payload)
        assert res.status_code in (200, 201)
    finally:
        test_app.dependency_overrides.clear()

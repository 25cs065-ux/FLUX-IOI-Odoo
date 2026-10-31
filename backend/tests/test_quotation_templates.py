import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.quotation_template import (
    QuotationTemplateCreate,
    TemplateLineCreate
)
from app.routers.quotation_templates import router as templates_router

test_app = FastAPI()
test_app.include_router(templates_router)
client = TestClient(test_app)

def test_valid_template_creation():
    template = QuotationTemplateCreate(
        name="Standard Enterprise Plan",
        validity_days=45,
        lines=[
            TemplateLineCreate(
                product_id="prod-123",
                quantity=2,
                unit_price=150.0,
                discount_percentage=10.0
            )
        ]
    )
    assert template.name == "Standard Enterprise Plan"
    assert template.validity_days == 45
    assert len(template.lines) == 1
    assert template.lines[0].unit_price == 150.0

def test_negative_validity_days_fails():
    with pytest.raises(ValidationError):
        QuotationTemplateCreate(
            name="Invalid Days",
            validity_days=0
        )

def test_zero_quantity_line_fails():
    with pytest.raises(ValidationError):
        TemplateLineCreate(
            product_id="prod-123",
            quantity=0,
            unit_price=50.0
        )

def test_negative_unit_price_fails():
    with pytest.raises(ValidationError):
        TemplateLineCreate(
            product_id="prod-123",
            quantity=1,
            unit_price=-10.0
        )

def test_discount_percentage_over_100_fails():
    with pytest.raises(ValidationError):
        TemplateLineCreate(
            product_id="prod-123",
            quantity=1,
            unit_price=100.0,
            discount_percentage=105.0
        )

def test_admin_enforcement_blocks_non_admin_creation():
    payload = {
        "name": "Admin Only Template",
        "validity_days": 30,
        "lines": []
    }
    res = client.post("/quotation-templates/", json=payload, headers={"X-User-Role": "customer"})
    assert res.status_code == 403

def test_admin_enforcement_blocks_missing_role():
    payload = {
        "name": "Admin Only Template",
        "validity_days": 30,
        "lines": []
    }
    res = client.post("/quotation-templates/", json=payload)
    assert res.status_code == 403

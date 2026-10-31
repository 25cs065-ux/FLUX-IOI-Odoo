import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from fastapi import FastAPI
from app.schemas.variant import VariantCreate
from app.routers.variants import router as variants_router, calculate_final_price
from app.core.auth import get_current_user

test_app = FastAPI()
test_app.include_router(variants_router)
client = TestClient(test_app)

def test_valid_variant_creation():
    variant = VariantCreate(product_id="prod-123", name="Standard", extra_price=10.0)
    assert variant.name == "Standard"
    assert variant.extra_price == 10.0

def test_negative_extra_price_validation_error():
    with pytest.raises(ValidationError):
        VariantCreate(product_id="prod-123", name="Standard", extra_price=-5.0)

def test_calculate_final_price_success():
    assert calculate_final_price(100.0, 15.0) == 115.0

def test_calculate_final_price_negative_base_fails():
    with pytest.raises(Exception):
        calculate_final_price(-10.0, 5.0)

def test_calculate_final_price_negative_extra_fails():
    with pytest.raises(Exception):
        calculate_final_price(100.0, -5.0)

def test_admin_enforcement_blocks_missing_token():
    payload = {"product_id": "00000000-0000-0000-0000-000000000000", "name": "Test", "extra_price": 5.0}
    res = client.post("/variants/", json=payload)
    assert res.status_code == 401

def test_admin_enforcement_blocks_customer():
    test_app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "email": "c@test.com", "role": "customer"}
    try:
        payload = {"product_id": "00000000-0000-0000-0000-000000000000", "name": "Test", "extra_price": 5.0}
        res = client.post("/variants/", json=payload)
        assert res.status_code == 403
    finally:
        test_app.dependency_overrides.clear()

"""Checks the API code against database/remaining_schema.sql: every column we
write exists, required columns are always supplied on insert, generated
columns are never written, and response models only expose real columns."""
from datetime import timedelta

import pytest

from app.schemas.invoice import InvoiceLineResponse, InvoiceSummary
from app.schemas.subscription import (
    StatusHistoryResponse,
    SubscriptionLineResponse,
    SubscriptionSummary,
)
from schema_utils import assert_writes_match_schema, load_schema
from test_subscriptions import TODAY, advance, client, create, repo  # noqa: F401  (fixtures)


@pytest.mark.parametrize("model,table", [
    (SubscriptionSummary, "subscriptions"),
    (SubscriptionLineResponse, "subscription_lines"),
    (StatusHistoryResponse, "subscription_status_history"),
])
def test_response_models_only_use_real_columns(model, table):
    assert set(model.model_fields) <= load_schema()[table].columns


def test_subscriptions_response_exposes_every_column():
    assert load_schema()["subscriptions"].columns == set(SubscriptionSummary.model_fields)


def test_subscription_flows_write_only_real_columns(client, repo):
    sub = create(client, repo, lines=[
        {"variant_id": repo.variant["id"], "tax_id": repo.gst["id"], "discount_percent": 5},
        {"description": "Setup", "unit_price": "10"},
    ]).json()
    client.patch(f"/subscriptions/{sub['id']}", json={
        "quantity": 3, "notes": "x", "end_date": (TODAY + timedelta(days=90)).isoformat(),
        "trial_end_date": (TODAY + timedelta(days=3)).isoformat(),
    })
    advance(client, sub["id"], "send-quotation", "confirm", "activate", "pause", "resume", "renew", "close")
    assert_writes_match_schema(repo.writes)


# ---------------------------------------------------------------- invoices


@pytest.mark.parametrize("model,table", [(InvoiceSummary, "invoices"), (InvoiceLineResponse, "invoice_lines")])
def test_invoice_models_expose_exactly_the_table_columns(model, table):
    assert set(model.model_fields) == load_schema()[table].columns

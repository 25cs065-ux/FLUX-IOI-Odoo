import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.current_user import CurrentUser, Role, get_current_user
from app.main import app
from app.repositories.invoice_repository import get_invoice_repository
from app.repositories.payment_repository import get_payment_repository
from app.repositories.subscription_repository import get_subscription_repository
from app.services.payment_service import derive_invoice_status
from payment_fakes import FakePaymentRepository, new_id
from schema_utils import assert_writes_match_schema
from subscription_fakes import seed_catalog
from test_subscriptions import ADMIN, CUSTOMER_USER, OTHER_CUSTOMER_USER, STAFF, TODAY

PAST = (TODAY - timedelta(days=10)).isoformat()


@pytest.fixture
def repo():
    return seed_catalog(FakePaymentRepository(), CUSTOMER_USER.id, OTHER_CUSTOMER_USER.id)


@pytest.fixture
def client(repo):
    state = {"user": ADMIN}
    for dependency in (get_subscription_repository, get_invoice_repository, get_payment_repository):
        app.dependency_overrides[dependency] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    class Client(TestClient):
        def as_user(self, user):
            state["user"] = user
            return self

    yield Client(app)
    app.dependency_overrides.clear()


def issued_invoice(client, repo, total="100.00", send=True, **overrides):
    body = {"customer_id": repo.customer["id"],
            "lines": [{"description": "Service", "unit_price": total}], **overrides}
    inv = client.post("/invoices", json=body).json()
    if send:
        client.post(f"/invoices/{inv['id']}/send")
    return inv


def pay(client, invoice_id, amount, **extra):
    return client.post("/payments", json={"invoice_id": invoice_id, "amount": str(amount), **extra})


def invoice(client, invoice_id):
    return client.get(f"/invoices/{invoice_id}").json()


# ---------------------------------------------------------------- balance rules

@pytest.mark.parametrize("paid,due_offset,expected", [
    ("100", 5, "paid"), ("120", 5, "paid"), ("40", 5, "partial"), ("0", 5, "sent"),
    ("40", -1, "overdue"), ("0", -1, "overdue"), ("100", -1, "paid"),
])
def test_derive_invoice_status(paid, due_offset, expected):
    assert derive_invoice_status(Decimal("100"), Decimal(paid), TODAY + timedelta(days=due_offset), TODAY) == expected


# ---------------------------------------------------------------- recording

def test_full_payment_marks_invoice_paid(client, repo):
    inv = issued_invoice(client, repo)
    res = pay(client, inv["id"], "100.00", method="upi")
    assert res.status_code == 201, res.text
    payment, updated = res.json()["payment"], res.json()["invoice"]
    assert payment["status"] == "completed" and payment["method"] == "upi"
    assert payment["customer_id"] == repo.customer["id"] and payment["recorded_by"] == str(ADMIN.id)
    assert payment["payment_reference"].startswith("PAY-") and payment["payment_date"] == TODAY.isoformat()
    assert updated["status"] == "paid" and updated["paid_at"]
    assert Decimal(updated["amount_paid"]) == Decimal("100") and Decimal(updated["amount_due"]) == 0


def test_partial_payments_then_settle(client, repo):
    inv = issued_invoice(client, repo)
    first = pay(client, inv["id"], "30").json()["invoice"]
    assert first["status"] == "partial" and Decimal(first["amount_due"]) == Decimal("70")
    second = pay(client, inv["id"], "70").json()["invoice"]
    assert second["status"] == "paid" and Decimal(second["amount_paid"]) == Decimal("100")


def test_overpayment_is_rejected(client, repo):
    inv = issued_invoice(client, repo)
    pay(client, inv["id"], "60")
    res = pay(client, inv["id"], "40.01")
    assert res.status_code == 409 and "40.00" in res.json()["detail"]
    assert len(repo.payments) == 1
    assert pay(client, inv["id"], "40").status_code == 201
    assert pay(client, inv["id"], "0.01").status_code == 409        # invoice is now paid


def test_overdue_invoice_can_be_paid(client, repo):
    inv = issued_invoice(client, repo, issue_date=PAST, due_date=PAST)
    client.post("/invoices/mark-overdue")
    assert pay(client, inv["id"], "50").json()["invoice"]["status"] == "overdue"   # still late
    assert pay(client, inv["id"], "50").json()["invoice"]["status"] == "paid"


def test_paid_overdue_invoice_ignored_by_overdue_job(client, repo):
    inv = issued_invoice(client, repo, issue_date=PAST, due_date=PAST)
    pay(client, inv["id"], "100")
    assert client.post("/invoices/mark-overdue").json() == {"marked_overdue": []}


@pytest.mark.parametrize("make", ["draft", "cancelled", "void"])
def test_only_issued_invoices_accept_payments(client, repo, make):
    inv = issued_invoice(client, repo, send=make == "void")
    if make != "draft":
        client.post(f"/invoices/{inv['id']}/{'cancel' if make == 'cancelled' else 'void'}")
    assert pay(client, inv["id"], "10").status_code == 409
    assert repo.payments == {}


@pytest.mark.parametrize("extra,code", [
    ({"amount": "0"}, 422),
    ({"amount": "-5"}, 422),
    ({"amount": "1.005"}, 422),
    ({"currency": "USD"}, 422),
    ({"payment_date": (TODAY + timedelta(days=1)).isoformat()}, 422),
    ({"method": "bitcoin"}, 422),
    ({"status": "refunded"}, 422),
])
def test_invalid_payment_input(client, repo, extra, code):
    inv = issued_invoice(client, repo)
    body = {"invoice_id": inv["id"], "amount": "10", **extra}
    assert client.post("/payments", json=body).status_code == code
    assert repo.payments == {}


def test_unknown_invoice(client):
    assert pay(client, str(uuid.uuid4()), "10").status_code == 404


# ---------------------------------------------------------------- duplicates

def test_same_reference_is_idempotent(client, repo):
    inv = issued_invoice(client, repo)
    first = pay(client, inv["id"], "40", payment_reference="BANK-123")
    replay = pay(client, inv["id"], "40", payment_reference="BANK-123")
    assert (first.status_code, replay.status_code) == (201, 200)
    assert replay.json()["payment"]["id"] == first.json()["payment"]["id"]
    assert len(repo.payments) == 1 and Decimal(invoice(client, inv["id"])["amount_paid"]) == Decimal("40")


def test_reference_reused_for_a_different_payment(client, repo):
    inv = issued_invoice(client, repo)
    other = issued_invoice(client, repo)
    pay(client, inv["id"], "40", payment_reference="BANK-123")
    assert pay(client, inv["id"], "41", payment_reference="BANK-123").status_code == 409
    assert pay(client, other["id"], "40", payment_reference="BANK-123").status_code == 409
    assert len(repo.payments) == 1


def test_duplicate_gateway_payment_is_not_recorded_twice(client, repo):
    inv = issued_invoice(client, repo)
    body = {"gateway": "razorpay", "gateway_payment_id": "pay_ABC", "method": "credit_card"}
    assert pay(client, inv["id"], "25", **body).status_code == 201
    assert pay(client, inv["id"], "25", **body).status_code == 200
    assert len(repo.payments) == 1


def test_replay_works_after_invoice_is_paid(client, repo):
    inv = issued_invoice(client, repo)
    pay(client, inv["id"], "100", payment_reference="R1")
    assert pay(client, inv["id"], "100", payment_reference="R1").status_code == 200


# ---------------------------------------------------------------- pending payments

def test_pending_payment_reserves_balance_until_confirmed(client, repo):
    inv = issued_invoice(client, repo)
    pending = pay(client, inv["id"], "60", status="pending").json()
    assert pending["payment"]["status"] == "pending"
    assert Decimal(pending["invoice"]["amount_paid"]) == 0 and pending["invoice"]["status"] == "sent"
    assert pay(client, inv["id"], "50").status_code == 409          # 60 reserved

    confirmed = client.post(f"/payments/{pending['payment']['id']}/confirm").json()
    assert confirmed["payment"]["status"] == "completed"
    assert confirmed["invoice"]["status"] == "partial" and Decimal(confirmed["invoice"]["amount_paid"]) == 60
    assert client.post(f"/payments/{pending['payment']['id']}/confirm").status_code == 409


def test_failed_pending_payment_releases_reservation(client, repo):
    inv = issued_invoice(client, repo)
    pending = pay(client, inv["id"], "100", status="pending").json()["payment"]
    res = client.post(f"/payments/{pending['id']}/fail")
    assert res.json()["payment"]["status"] == "failed" and res.json()["invoice"]["status"] == "sent"
    assert pay(client, inv["id"], "100").status_code == 201
    assert client.post(f"/payments/{pending['id']}/fail").status_code == 409


# ---------------------------------------------------------------- refunds

def test_full_refund_reopens_invoice(client, repo):
    inv = issued_invoice(client, repo)
    payment = pay(client, inv["id"], "100").json()["payment"]
    res = client.post(f"/payments/{payment['id']}/refund", json={"reason": "Duplicate charge"})
    assert res.status_code == 200, res.text
    refunded, updated = res.json()["payment"], res.json()["invoice"]
    assert refunded["status"] == "refunded" and Decimal(refunded["refunded_amount"]) == 100
    assert refunded["refunded_at"] and "Duplicate charge" in refunded["notes"]
    assert updated["status"] == "sent" and Decimal(updated["amount_paid"]) == 0 and updated["paid_at"] is None
    assert client.post(f"/payments/{payment['id']}/refund").status_code == 409
    assert client.post(f"/invoices/{inv['id']}/void").json()["status"] == "void"


def test_partial_refunds(client, repo):
    inv = issued_invoice(client, repo)
    payment = pay(client, inv["id"], "100").json()["payment"]
    first = client.post(f"/payments/{payment['id']}/refund", json={"amount": "30"}).json()
    assert first["payment"]["status"] == "partially_refunded"
    assert first["invoice"]["status"] == "partial" and Decimal(first["invoice"]["amount_due"]) == 30
    assert client.post(f"/payments/{payment['id']}/refund", json={"amount": "70.01"}).status_code == 409
    rest = client.post(f"/payments/{payment['id']}/refund").json()
    assert rest["payment"]["status"] == "refunded" and Decimal(rest["payment"]["refunded_amount"]) == 100


def test_refunded_amount_can_be_paid_again(client, repo):
    inv = issued_invoice(client, repo)
    payment = pay(client, inv["id"], "100").json()["payment"]
    client.post(f"/payments/{payment['id']}/refund", json={"amount": "25"})
    assert pay(client, inv["id"], "25.01").status_code == 409
    assert pay(client, inv["id"], "25").json()["invoice"]["status"] == "paid"


def test_pending_and_failed_payments_cannot_be_refunded(client, repo):
    inv = issued_invoice(client, repo)
    pending = pay(client, inv["id"], "10", status="pending").json()["payment"]
    assert client.post(f"/payments/{pending['id']}/refund").status_code == 409


# ---------------------------------------------------------------- consistency on failure

def test_balance_update_failure_rolls_back_payment(client, repo):
    inv = issued_invoice(client, repo)
    repo.fail_invoice_update = True
    with pytest.raises(RuntimeError):
        pay(client, inv["id"], "40")
    repo.fail_invoice_update = False
    [payment] = repo.payments.values()
    assert payment["status"] == "failed" and "Rolled back" in payment["notes"]
    assert Decimal(invoice(client, inv["id"])["amount_paid"]) == 0
    assert pay(client, inv["id"], "100").status_code == 201        # balance not consumed


def test_concurrent_payment_cannot_overpay(client, repo):
    inv = issued_invoice(client, repo)

    def competing_request():    # lands between our pre-check and our insert completing
        repo.payments[new_id()] = {
            "id": new_id(), "payment_reference": "OTHER", "invoice_id": inv["id"],
            "customer_id": repo.customer["id"], "status": "completed", "amount": "80.00",
            "refunded_amount": "0.00", "gateway": None, "gateway_payment_id": None,
            "created_at": "0", "notes": None,
        }

    repo.after_payment_insert = competing_request
    res = pay(client, inv["id"], "50")
    assert res.status_code == 409
    ours = next(p for p in repo.payments.values() if p["payment_reference"] != "OTHER")
    assert ours["status"] == "failed"
    after = invoice(client, inv["id"])
    assert Decimal(after["amount_paid"]) == 80 and after["status"] == "partial"


def test_refund_rolls_back_when_balance_update_fails(client, repo):
    inv = issued_invoice(client, repo)
    payment = pay(client, inv["id"], "100").json()["payment"]
    repo.fail_invoice_update = True
    with pytest.raises(RuntimeError):
        client.post(f"/payments/{payment['id']}/refund")
    repo.fail_invoice_update = False
    restored = client.get(f"/payments/{payment['id']}").json()
    assert restored["status"] == "completed" and Decimal(restored["refunded_amount"]) == 0
    assert invoice(client, inv["id"])["status"] == "paid"


def test_confirm_rolls_back_when_balance_update_fails(client, repo):
    inv = issued_invoice(client, repo)
    pending = pay(client, inv["id"], "100", status="pending").json()["payment"]
    repo.fail_invoice_update = True
    with pytest.raises(RuntimeError):
        client.post(f"/payments/{pending['id']}/confirm")
    repo.fail_invoice_update = False
    assert client.get(f"/payments/{pending['id']}").json()["status"] == "pending"
    assert invoice(client, inv["id"])["status"] == "sent"


def test_recalculate_repairs_a_drifted_balance(client, repo):
    inv = issued_invoice(client, repo)
    pay(client, inv["id"], "100")
    repo.invoices[inv["id"]].update(amount_paid="0.00", status="sent", amount_due="100.00")
    res = client.post(f"/payments/recalculate/{inv['id']}")
    assert res.status_code == 200
    assert res.json()["status"] == "paid" and Decimal(res.json()["amount_paid"]) == 100
    assert client.post(f"/payments/recalculate/{uuid.uuid4()}").status_code == 404


def test_concurrent_balance_writer_is_retried(client, repo):
    inv = issued_invoice(client, repo)
    original = repo.update_invoice
    calls = {"n": 0}

    def flaky_update(invoice_id, data, expected_status=None, expected_amount_paid=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return None         # someone else changed the invoice first
        return original(invoice_id, data, expected_status, expected_amount_paid)

    repo.update_invoice = flaky_update
    assert pay(client, inv["id"], "100").json()["invoice"]["status"] == "paid"
    assert calls["n"] == 2


# ---------------------------------------------------------------- RBAC

def test_customers_see_only_their_payments(client, repo):
    mine = issued_invoice(client, repo)
    theirs = issued_invoice(client, repo, customer_id=repo.other_customer["id"])
    my_payment = pay(client, mine["id"], "10").json()["payment"]
    their_payment = pay(client, theirs["id"], "10").json()["payment"]

    client.as_user(CUSTOMER_USER)
    assert [p["id"] for p in client.get("/payments").json()] == [my_payment["id"]]
    assert client.get(f"/payments/{my_payment['id']}").status_code == 200
    assert client.get(f"/payments/{their_payment['id']}").status_code == 404
    unlinked = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)
    assert client.as_user(unlinked).get("/payments").json() == []


@pytest.mark.parametrize("user,method,path,code", [
    (CUSTOMER_USER, "post", "/payments", 403),
    (CUSTOMER_USER, "post", f"/payments/{uuid.uuid4()}/confirm", 403),
    (CUSTOMER_USER, "post", f"/payments/{uuid.uuid4()}/refund", 403),
    (STAFF, "post", f"/payments/{uuid.uuid4()}/refund", 403),         # refunds are admin only
    (CUSTOMER_USER, "post", f"/payments/recalculate/{uuid.uuid4()}", 403),
])
def test_role_restrictions(client, user, method, path, code):
    assert getattr(client.as_user(user), method)(path, json={}).status_code == code


def test_staff_can_record_payments(client, repo):
    inv = issued_invoice(client, repo)
    assert pay(client.as_user(STAFF), inv["id"], "10").status_code == 201


def test_payments_require_authentication(repo):
    app.dependency_overrides[get_payment_repository] = lambda: repo
    try:
        anon = TestClient(app)
        assert anon.get("/payments").status_code == 401
        assert anon.post("/payments", json={}).status_code == 401
        assert anon.get("/payments", headers={"Authorization": "Bearer forged"}).status_code == 503
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------- docs and schema

def test_openapi_documents_payment_endpoints():
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    for path in ["/payments", "/payments/{payment_id}", "/payments/{payment_id}/confirm",
                 "/payments/{payment_id}/fail", "/payments/{payment_id}/refund",
                 "/payments/recalculate/{invoice_id}"]:
        assert path in paths, path


def test_payment_flows_write_only_real_columns(client, repo):
    inv = issued_invoice(client, repo)
    payment = pay(client, inv["id"], "60", payment_reference="X1", gateway="stripe",
                  gateway_payment_id="pi_1", gateway_response={"ok": True}).json()["payment"]
    pending = pay(client, inv["id"], "40", status="pending").json()["payment"]
    client.post(f"/payments/{pending['id']}/confirm")
    client.post(f"/payments/{payment['id']}/refund", json={"amount": "10"})
    repo.fail_invoice_update = True
    with pytest.raises(RuntimeError):
        pay(client, inv["id"], "5")
    repo.fail_invoice_update = False
    assert {t for t, _, _ in repo.writes} >= {"payments", "invoices"}
    assert_writes_match_schema(repo.writes)


# ---------------------------------------------------------------- void vs payment

def test_void_blocked_by_pending_payment(client, repo):
    inv = issued_invoice(client, repo)
    pending = pay(client, inv["id"], "10", status="pending").json()["payment"]
    assert client.post(f"/invoices/{inv['id']}/void").status_code == 409
    client.post(f"/payments/{pending['id']}/fail")
    assert client.post(f"/invoices/{inv['id']}/void").json()["status"] == "void"


def test_payment_landing_during_void_undoes_the_void(client, repo):
    inv = issued_invoice(client, repo)
    original = repo.update_invoice

    def payment_lands_mid_void(invoice_id, data, *args, **kwargs):
        result = original(invoice_id, data, *args, **kwargs)
        if data.get("status") == "void":
            repo.payments[new_id()] = {
                "id": new_id(), "payment_reference": "RACE", "invoice_id": inv["id"],
                "customer_id": repo.customer["id"], "status": "completed", "amount": "40.00",
                "refunded_amount": "0.00", "gateway": None, "gateway_payment_id": None,
                "created_at": "1", "notes": None,
            }
        return result

    repo.update_invoice = payment_lands_mid_void
    res = client.post(f"/invoices/{inv['id']}/void")
    assert res.status_code == 409 and "not voided" in res.json()["detail"]
    after = invoice(client, inv["id"])
    assert after["status"] == "sent" and after["voided_at"] is None


def test_void_landing_during_payment_fails_the_payment(client, repo):
    inv = issued_invoice(client, repo)

    def void_lands_mid_payment():
        repo.invoices[inv["id"]]["status"] = "void"

    repo.after_payment_insert = void_lands_mid_payment
    res = pay(client, inv["id"], "40")
    assert res.status_code == 409 and "voided or cancelled" in res.json()["detail"]
    [payment] = repo.payments.values()
    assert payment["status"] == "failed"
    after = invoice(client, inv["id"])
    assert after["status"] == "void" and Decimal(after["amount_paid"]) == 0

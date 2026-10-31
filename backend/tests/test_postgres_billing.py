"""REAL-DATABASE tests (not mocks).

Run against a throwaway local PostgreSQL 16 started by pixeltable-pgserver,
loaded with the real database/remaining_schema.sql and the real
database/migrations/20261031_billing_transactions.sql. The API runs in
transactional mode (as with BILLING_DB_FUNCTIONS=true), so every multi-table
write goes through the billing_* functions.

Skipped automatically when pixeltable-pgserver / psycopg2 are not installed.
This is not the live Supabase project: teammate tables are stand-ins
(see pg_harness.PREREQUISITES).
"""
import threading
import time
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

pytest.importorskip("pixeltable_pgserver")
pytest.importorskip("psycopg2")

import pg_harness  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.current_user import get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.repositories.billing_rpc import RuleViolation  # noqa: E402
from app.repositories.invoice_repository import DuplicateInvoiceError, get_invoice_repository  # noqa: E402
from app.repositories.payment_repository import get_payment_repository  # noqa: E402
from app.repositories.subscription_repository import get_subscription_repository  # noqa: E402
from test_subscriptions import ADMIN, CUSTOMER_USER, STAFF  # noqa: E402

pytestmark = pytest.mark.postgres
TODAY = date.today()


@pytest.fixture(scope="module")
def server():
    srv = pg_harness.start_server()
    yield srv
    srv.cleanup()


@pytest.fixture
def db(server):
    conn = pg_harness.connect(server)
    pg_harness.truncate_all(conn)
    repo = pg_harness.PgRepository(conn)
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO auth.users (id) VALUES (%s)", [(u.id,) for u in (STAFF, ADMIN, CUSTOMER_USER)])
    repo.customer = repo._insert("customers", {"name": "Acme", "email": "acme@x.test",
                                               "auth_user_id": str(CUSTOMER_USER.id)})
    repo.plan = repo._insert("plans", {"name": "Pro Monthly", "interval": "monthly", "price": Decimal("100")})
    repo.locked_plan = repo._insert("plans", {"name": "Locked", "interval": "monthly", "price": Decimal("100"),
                                              "pausable": False})
    repo.product = repo._insert("products", {"name": "Seat", "price": Decimal("50")})
    repo.gst = repo._insert("taxes", {"name": "GST", "rate": Decimal("18")})
    repo.net30 = repo._insert("payment_terms", {"name": "Net 30", "days_due": 30})
    repo.server = server
    yield repo
    conn.close()


@pytest.fixture
def client(db):
    state = {"user": ADMIN}
    for dependency in (get_subscription_repository, get_invoice_repository, get_payment_repository):
        app.dependency_overrides[dependency] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: state["user"]
    yield TestClient(app)
    app.dependency_overrides.clear()


def scalar(db, query, params=()):
    rows = db._rows(query, params)
    return next(iter(rows[0].values())) if rows else None


def active_subscription(client, db, **overrides):
    body = {"customer_id": str(db.customer["id"]), "plan_id": str(db.plan["id"]), "quantity": 2,
            "start_date": TODAY.isoformat(), "end_date": (TODAY + timedelta(days=365)).isoformat(),
            "lines": [{"product_id": str(db.product["id"]), "quantity": 2, "tax_id": str(db.gst["id"])}]}
    body.update(overrides)
    sub = client.post("/subscriptions", json=body)
    assert sub.status_code == 201, sub.text
    for action in ("confirm", "activate"):
        assert client.post(f"/subscriptions/{sub.json()['id']}/{action}").status_code == 200
    return sub.json()


def sent_invoice(client, db, total="100.00"):
    inv = client.post("/invoices", json={"customer_id": str(db.customer["id"]),
                                         "lines": [{"description": "Service", "unit_price": total}]}).json()
    assert client.post(f"/invoices/{inv['id']}/send").status_code == 200
    return inv


def run_blocked(func):
    """Run func in a thread; return (thread, outcome dict)."""
    outcome = {}

    def target():
        try:
            outcome["result"] = func()
        except Exception as exc:          # noqa: BLE001 - captured for the assertion
            outcome["error"] = exc

    thread = threading.Thread(target=target)
    thread.start()
    return thread, outcome


def assert_waiting(thread):
    time.sleep(0.6)
    assert thread.is_alive(), "second transaction should be blocked on the row lock"


# ---------------------------------------------------------------- schema and permissions

def test_functions_are_service_role_only(db):
    for role, allowed in (("anon", False), ("authenticated", False), ("service_role", True)):
        assert scalar(db, "SELECT has_function_privilege(%s, 'billing_record_payment(jsonb,date)', 'execute')",
                      (role,)) is allowed


# ---------------------------------------------------------------- end-to-end API flow (transactional mode)

def test_full_billing_flow_through_the_api(client, db):
    sub = active_subscription(client, db, payment_terms_id=str(db.net30["id"]))
    assert Decimal(str(sub["total_amount"])) == Decimal("118.00")
    assert scalar(db, "SELECT count(*) FROM subscription_status_history WHERE subscription_id = %s",
                  (sub["id"],)) == 3

    inv = client.post("/invoices/generate", json={"subscription_id": sub["id"]})
    assert inv.status_code == 201, inv.text
    inv = inv.json()
    assert inv["invoice_number"].startswith("INV-") and len(inv["lines"]) == 1
    assert inv["due_date"] == (TODAY + timedelta(days=30)).isoformat()
    next_date = scalar(db, "SELECT next_billing_date FROM subscriptions WHERE id = %s", (sub["id"],))
    assert next_date == date.fromisoformat(inv["billing_period_end"]) + timedelta(days=1)

    client.post(f"/invoices/{inv['id']}/send")
    first = client.post("/payments", json={"invoice_id": inv["id"], "amount": "18.00", "payment_reference": "R1"})
    assert first.status_code == 201 and first.json()["invoice"]["status"] == "partial"
    replay = client.post("/payments", json={"invoice_id": inv["id"], "amount": "18.00", "payment_reference": "R1"})
    assert replay.status_code == 200
    assert client.post("/payments", json={"invoice_id": inv["id"], "amount": "100.01"}).status_code == 409
    paid = client.post("/payments", json={"invoice_id": inv["id"], "amount": "100.00"}).json()
    assert paid["invoice"]["status"] == "paid" and paid["invoice"]["paid_at"]

    assert client.post(f"/invoices/{inv['id']}/void").status_code == 409
    for payment_id in (first.json()["payment"]["id"], paid["payment"]["id"]):
        refunded = client.post(f"/payments/{payment_id}/refund", json={"reason": "test"})
        assert refunded.status_code == 200, refunded.text
    assert refunded.json()["invoice"]["status"] == "sent"
    voided = client.post(f"/invoices/{inv['id']}/void")
    assert voided.status_code == 200 and voided.json()["status"] == "void"
    # Voiding the latest period released it for re-billing, in the same transaction.
    assert scalar(db, "SELECT next_billing_date FROM subscriptions WHERE id = %s", (sub["id"],)) == TODAY


def test_line_edits_and_optimistic_lock(client, db):
    sub = client.post("/subscriptions", json={"customer_id": str(db.customer["id"]), "plan_id": str(db.plan["id"]),
                                              "start_date": TODAY.isoformat()}).json()
    res = client.patch(f"/subscriptions/{sub['id']}", json={"lines": [
        {"description": "A", "unit_price": "1"}, {"description": "B", "unit_price": "2"}]})
    assert res.status_code == 200 and [l["description"] for l in res.json()["lines"]] == ["A", "B"]
    assert scalar(db, "SELECT count(*) FROM subscription_lines WHERE subscription_id = %s", (sub["id"],)) == 2
    # The API read updated_at before this out-of-band save, so its edit must lose.
    original = db.get_subscription
    db.get_subscription = lambda sid: {**original(sid), "updated_at": "2000-01-01T00:00:00+00:00"}
    assert client.patch(f"/subscriptions/{sub['id']}", json={"notes": "late"}).status_code == 409
    db.get_subscription = original
    assert scalar(db, "SELECT notes FROM subscriptions WHERE id = %s", (sub["id"],)) is None


def test_billing_run_catches_up_atomically(client, db):
    sub = active_subscription(client, db, start_date=(TODAY - timedelta(days=40)).isoformat())
    res = client.post("/invoices/billing-run").json()
    assert len(res["created"]) == 2 and res["failed"] == [] and res["skipped"] == []
    assert client.post("/invoices/billing-run").json()["created"] == []
    assert scalar(db, "SELECT count(*) FROM invoices WHERE subscription_id = %s", (sub["id"],)) == 2


# ---------------------------------------------------------------- all-or-nothing writes

def test_failed_line_rolls_back_subscription_create(db):
    header = {"customer_id": db.customer["id"], "plan_id": db.plan["id"], "start_date": TODAY,
              "unit_price": Decimal("1"), "total_amount": Decimal("1"), "created_by": STAFF.id}
    bad_line = {"description": "x", "quantity": 0, "unit_price": 1, "subtotal": 0, "line_total": 0}  # CHECK quantity > 0
    with pytest.raises(Exception):
        db.create_subscription_tx(header, [bad_line], {"to_status": "draft"})
    assert scalar(db, "SELECT count(*) FROM subscriptions") == 0


def test_failed_line_rolls_back_header_update(client, db):
    sub = client.post("/subscriptions", json={"customer_id": str(db.customer["id"]), "plan_id": str(db.plan["id"]),
                                              "start_date": TODAY.isoformat()}).json()
    bad = [{"description": "x", "quantity": 1, "unit_price": -5, "subtotal": 0, "line_total": 0}]  # CHECK unit_price >= 0
    with pytest.raises(Exception):
        db.update_subscription_tx(sub["id"], "draft", sub["updated_at"], {"notes": "changed"}, bad)
    row = db.get_subscription(sub["id"])
    assert row["notes"] is None and row["updated_at"].isoformat().startswith(sub["updated_at"][:19])
    assert [l["description"] for l in db.list_lines(sub["id"])] == ["Pro Monthly"]


def test_failed_invoice_line_does_not_advance_subscription(client, db):
    sub = active_subscription(client, db)
    header = {"customer_id": db.customer["id"], "subscription_id": sub["id"], "due_date": TODAY,
              "billing_period_start": TODAY, "billing_period_end": TODAY + timedelta(days=29)}
    bad = [{"description": "x", "unit_price": 1, "subtotal": -1, "line_total": 0}]          # CHECK subtotal >= 0
    with pytest.raises(Exception):
        db.create_invoice_tx(header, bad, sub["id"], TODAY, TODAY + timedelta(days=30))
    assert scalar(db, "SELECT count(*) FROM invoices") == 0
    assert scalar(db, "SELECT next_billing_date FROM subscriptions WHERE id = %s", (sub["id"],)) == TODAY


def test_same_period_cannot_be_billed_twice(client, db):
    sub = active_subscription(client, db)
    assert client.post("/invoices/generate", json={"subscription_id": sub["id"]}).status_code == 201
    header = {"customer_id": db.customer["id"], "subscription_id": sub["id"], "due_date": TODAY,
              "billing_period_start": TODAY, "billing_period_end": TODAY}
    with pytest.raises(RuleViolation) as stale:          # next_billing_date already moved on
        db.create_invoice_tx(header, [], sub["id"], TODAY, TODAY + timedelta(days=1))
    assert stale.value.status_code == 409
    db.update_subscription(sub["id"], {"next_billing_date": TODAY})       # simulate an old partial run
    period_end = scalar(db, "SELECT billing_period_end FROM invoices WHERE subscription_id = %s", (sub["id"],))
    with pytest.raises(DuplicateInvoiceError):           # uix_invoice_live_period
        db.create_invoice_tx({**header, "billing_period_end": period_end}, [], sub["id"], TODAY, period_end)
    assert scalar(db, "SELECT count(*) FROM invoices") == 1


# ---------------------------------------------------------------- real concurrency (two connections)

def payment_payload(invoice_id, amount, reference=None):
    return {"invoice_id": invoice_id, "amount": Decimal(amount), "method": "upi", "status": "completed",
            "payment_reference": reference or f"PAY-{uuid.uuid4().hex[:8]}", "recorded_by": STAFF.id}


def test_concurrent_payments_cannot_overpay(client, db):
    inv = sent_invoice(client, db)
    a = pg_harness.PgRepository(pg_harness.connect(db.server, autocommit=False))
    b = pg_harness.PgRepository(pg_harness.connect(db.server))
    a.record_payment_tx(payment_payload(inv["id"], "60"), TODAY)          # holds the invoice lock
    thread, outcome = run_blocked(lambda: b.record_payment_tx(payment_payload(inv["id"], "60"), TODAY))
    assert_waiting(thread)
    a.conn.commit()
    thread.join(10)
    assert isinstance(outcome.get("error"), RuleViolation) and outcome["error"].status_code == 409
    assert "outstanding balance of 40.00" in outcome["error"].message
    assert scalar(db, "SELECT amount_paid FROM invoices WHERE id = %s", (inv["id"],)) == Decimal("60.00")
    a.conn.close(), b.conn.close()


def test_void_waits_for_payment_then_refuses(client, db):
    inv = sent_invoice(client, db)
    a = pg_harness.PgRepository(pg_harness.connect(db.server, autocommit=False))
    b = pg_harness.PgRepository(pg_harness.connect(db.server))
    a.record_payment_tx(payment_payload(inv["id"], "10"), TODAY)
    thread, outcome = run_blocked(lambda: b.void_invoice_tx(inv["id"]))
    assert_waiting(thread)
    a.conn.commit()
    thread.join(10)
    assert isinstance(outcome.get("error"), RuleViolation) and outcome["error"].status_code == 409
    assert scalar(db, "SELECT status FROM invoices WHERE id = %s", (inv["id"],)) == "partial"
    a.conn.close(), b.conn.close()


def test_payment_waits_for_void_then_refuses(client, db):
    inv = sent_invoice(client, db)
    a = pg_harness.PgRepository(pg_harness.connect(db.server, autocommit=False))
    b = pg_harness.PgRepository(pg_harness.connect(db.server))
    a.void_invoice_tx(inv["id"])
    thread, outcome = run_blocked(lambda: b.record_payment_tx(payment_payload(inv["id"], "10"), TODAY))
    assert_waiting(thread)
    a.conn.commit()
    thread.join(10)
    assert isinstance(outcome.get("error"), RuleViolation) and "void invoice" in outcome["error"].message
    assert scalar(db, "SELECT count(*) FROM payments") == 0
    a.conn.close(), b.conn.close()


def test_concurrent_edits_second_one_loses(client, db):
    sub = client.post("/subscriptions", json={"customer_id": str(db.customer["id"]), "plan_id": str(db.plan["id"]),
                                              "start_date": TODAY.isoformat()}).json()
    read_at = db.get_subscription(sub["id"])["updated_at"]
    a = pg_harness.PgRepository(pg_harness.connect(db.server, autocommit=False))
    b = pg_harness.PgRepository(pg_harness.connect(db.server))
    a.update_subscription_tx(sub["id"], "draft", read_at, {"notes": "A"}, None)
    thread, outcome = run_blocked(lambda: b.update_subscription_tx(sub["id"], "draft", read_at, {"notes": "B"}, None))
    assert_waiting(thread)
    a.conn.commit()
    thread.join(10)
    assert outcome.get("error") is None and outcome["result"] is None        # optimistic lock lost -> API 409
    assert scalar(db, "SELECT notes FROM subscriptions WHERE id = %s", (sub["id"],)) == "A"
    a.conn.close(), b.conn.close()


def test_same_reference_from_two_connections_is_recorded_once(client, db):
    inv = sent_invoice(client, db)
    a = pg_harness.PgRepository(pg_harness.connect(db.server, autocommit=False))
    b = pg_harness.PgRepository(pg_harness.connect(db.server))
    a.record_payment_tx(payment_payload(inv["id"], "10", "SAME-REF"), TODAY)
    thread, outcome = run_blocked(lambda: b.record_payment_tx(payment_payload(inv["id"], "10", "SAME-REF"), TODAY))
    assert_waiting(thread)
    a.conn.commit()
    thread.join(10)
    assert outcome["result"]["replay"] is True
    assert scalar(db, "SELECT count(*) FROM payments") == 1
    a.conn.close(), b.conn.close()


# ---------------------------------------------------------------- database constraints as a last line

def test_database_rejects_impossible_refund(client, db):
    inv = sent_invoice(client, db)
    payment = db.record_payment_tx(payment_payload(inv["id"], "10"), TODAY)["payment"]
    with pytest.raises(Exception):
        db._update("payments", payment["id"], {"refunded_amount": Decimal("11")})   # CHECK refunded <= amount
    with pytest.raises(RuleViolation):
        db.change_payment_tx(payment["id"], "refund", TODAY, amount=Decimal("10.01"))

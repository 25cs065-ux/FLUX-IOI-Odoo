import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.current_user import get_current_user
from app.main import app
from app.repositories.invoice_repository import get_invoice_repository
from app.repositories.subscription_repository import get_subscription_repository
from app.services.invoice_service import add_months, billing_period_end, invoice_totals
from app.services.subscription_service import ConflictError
from invoice_fakes import FakeInvoiceRepository
from schema_utils import assert_writes_match_schema
from subscription_fakes import seed_catalog
from test_subscriptions import CUSTOMER_USER, OTHER_CUSTOMER_USER, STAFF, TODAY, advance, create

YEAR_END = (TODAY + timedelta(days=365)).isoformat()


@pytest.fixture
def repo():
    return seed_catalog(FakeInvoiceRepository(), CUSTOMER_USER.id, OTHER_CUSTOMER_USER.id)


@pytest.fixture
def client(repo):
    state = {"user": STAFF}
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    app.dependency_overrides[get_invoice_repository] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    class Client(TestClient):
        def as_user(self, user):
            state["user"] = user
            return self

    yield Client(app)
    app.dependency_overrides.clear()


def active_sub(client, repo, **overrides):
    overrides.setdefault("end_date", YEAR_END)
    sub = create(client, repo, **overrides)
    assert sub.status_code == 201, sub.text
    advance(client, sub.json()["id"], "confirm", "activate")
    return repo.get_subscription(sub.json()["id"])


def generate(client, sub_id, **body):
    return client.post("/invoices/generate", json={"subscription_id": sub_id, **body})


def manual(client, repo, **overrides):
    body = {"customer_id": repo.customer["id"],
            "lines": [{"product_id": repo.product["id"], "quantity": 2, "tax_id": repo.gst["id"]}]}
    body.update(overrides)
    return client.post("/invoices", json=body)


# ---------------------------------------------------------------- billing period maths

def test_add_months_clamps_to_month_end():
    assert add_months(date(2027, 1, 31), 1) == date(2027, 2, 28)
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)
    assert add_months(date(2027, 11, 15), 3) == date(2028, 2, 15)


def test_monthly_periods_stay_anchored_to_billing_day():
    anchor = date(2027, 1, 31)
    assert billing_period_end(anchor, anchor, "monthly") == date(2027, 2, 27)
    assert billing_period_end(anchor, date(2027, 2, 28), "monthly") == date(2027, 3, 30)
    assert billing_period_end(anchor, date(2027, 3, 31), "monthly") == date(2027, 4, 29)


@pytest.mark.parametrize("interval,expected", [
    ("daily", date(2027, 3, 10)),
    ("weekly", date(2027, 3, 16)),
    ("yearly", date(2028, 3, 9)),
])
def test_other_intervals(interval, expected):
    start = date(2027, 3, 10)
    assert billing_period_end(start, start, interval) == expected


def test_unknown_interval_is_rejected():
    with pytest.raises(ConflictError):
        billing_period_end(date(2027, 1, 1), date(2027, 1, 1), "hourly")


def test_header_tax_snapshot_only_for_a_single_tax():
    one = {"subtotal": 10, "discount_amount": 0, "tax_amount": 1, "line_total": 11,
           "tax_id": "a", "tax_name": "GST", "tax_rate": Decimal("18")}
    other = {**one, "tax_id": "b", "tax_name": "VAT", "tax_rate": Decimal("5")}
    assert invoice_totals([one, one])["tax_name"] == "GST"
    mixed = invoice_totals([one, other])
    assert mixed["tax_name"] is None and mixed["total_amount"] == Decimal("22")


# ---------------------------------------------------------------- generation

def test_generate_bills_first_period_and_advances_subscription(client, repo):
    sub = active_sub(client, repo, lines=[
        {"variant_id": repo.variant["id"], "quantity": 2, "tax_id": repo.gst["id"], "discount_percent": 10},
    ])
    res = generate(client, sub["id"])
    assert res.status_code == 201, res.text
    inv = res.json()
    period_end = add_months(TODAY, 1) - timedelta(days=1)
    assert inv["status"] == "draft"
    assert inv["invoice_number"].startswith("INV-")
    assert (inv["billing_period_start"], inv["billing_period_end"]) == (TODAY.isoformat(), period_end.isoformat())
    assert inv["issue_date"] == inv["due_date"] == TODAY.isoformat()        # no payment terms
    assert Decimal(inv["total_amount"]) == Decimal(sub["total_amount"]) == Decimal("159.30")
    assert Decimal(inv["amount_due"]) == Decimal("159.30")
    assert (inv["tax_name"], Decimal(inv["tax_rate"])) == ("GST", Decimal("18"))

    [line] = inv["lines"]
    sub_line = repo.list_lines(sub["id"])[0]
    assert line["subscription_line_id"] == sub_line["id"]
    assert (line["tax_name"], Decimal(line["tax_rate"])) == ("GST", Decimal("18"))
    assert repo.get_subscription(sub["id"])["next_billing_date"] == (period_end + timedelta(days=1)).isoformat()


def test_consecutive_generations_bill_consecutive_periods(client, repo):
    sub = active_sub(client, repo)
    first = generate(client, sub["id"]).json()
    second = generate(client, sub["id"]).json()
    assert date.fromisoformat(second["billing_period_start"]) == \
        date.fromisoformat(first["billing_period_end"]) + timedelta(days=1)


def test_same_period_cannot_be_billed_twice(client, repo):
    sub = active_sub(client, repo)
    assert generate(client, sub["id"]).status_code == 201
    repo.subscriptions[sub["id"]]["next_billing_date"] = TODAY.isoformat()   # rewind by hand
    res = generate(client, sub["id"])
    assert res.status_code == 409 and "already been invoiced" in res.json()["detail"]


def test_due_date_follows_payment_terms(client, repo):
    sub = active_sub(client, repo, payment_terms_id=repo.net30["id"])
    issue = TODAY + timedelta(days=2)
    inv = generate(client, sub["id"], issue_date=issue.isoformat()).json()
    assert inv["due_date"] == (issue + timedelta(days=30)).isoformat()


def test_trial_delays_first_period(client, repo):
    trial_end = TODAY + timedelta(days=14)
    sub = active_sub(client, repo, trial_end_date=trial_end.isoformat())
    inv = generate(client, sub["id"]).json()
    assert inv["billing_period_start"] == (trial_end + timedelta(days=1)).isoformat()


def test_last_period_is_capped_at_end_date(client, repo):
    end = TODAY + timedelta(days=10)
    sub = active_sub(client, repo, end_date=end.isoformat())
    inv = generate(client, sub["id"]).json()
    assert inv["billing_period_end"] == end.isoformat()
    assert repo.get_subscription(sub["id"])["next_billing_date"] is None
    assert generate(client, sub["id"]).status_code == 409


def test_generate_requires_active_subscription(client, repo):
    draft = create(client, repo).json()
    assert generate(client, draft["id"]).status_code == 409
    assert generate(client, str(uuid.uuid4())).status_code == 404
    paused = active_sub(client, repo)
    advance(client, paused["id"], "pause")
    assert generate(client, paused["id"]).status_code == 409


def test_tax_rate_change_does_not_alter_issued_invoice(client, repo):
    sub = active_sub(client, repo, lines=[{"description": "Svc", "unit_price": "100", "tax_id": repo.gst["id"]}])
    first = generate(client, sub["id"]).json()
    repo.taxes[repo.gst["id"]]["rate"] = 28
    second = generate(client, sub["id"]).json()
    assert Decimal(client.get(f"/invoices/{first['id']}").json()["tax_amount"]) == Decimal("18")
    assert Decimal(second["tax_amount"]) == Decimal("28")


def test_generation_rolls_back_when_lines_fail(client, repo):
    sub = active_sub(client, repo)
    repo.fail_invoice_line_insert = True
    with pytest.raises(RuntimeError):
        generate(client, sub["id"])
    assert repo.invoices == {}
    assert repo.get_subscription(sub["id"])["next_billing_date"] == TODAY.isoformat()


# ---------------------------------------------------------------- billing run

def test_billing_run_catches_up_and_is_idempotent(client, repo):
    behind = active_sub(client, repo, start_date=(TODAY - timedelta(days=40)).isoformat())
    future = active_sub(client, repo, start_date=(TODAY + timedelta(days=5)).isoformat())
    draft = create(client, repo).json()

    res = client.post("/invoices/billing-run", json={})
    assert res.status_code == 200, res.text
    created = res.json()["created"]
    assert [i["subscription_id"] for i in created] == [behind["id"], behind["id"]]   # 2 periods due
    assert res.json()["skipped"] == []
    assert {i["subscription_id"] for i in repo.invoices.values()} == {behind["id"]}
    assert future["id"] and draft["id"]

    again = client.post("/invoices/billing-run").json()
    assert again == {"created": [], "recovered": [], "skipped": [], "failed": []}


def test_billing_run_as_of_future_date(client, repo):
    sub = active_sub(client, repo)
    as_of = add_months(TODAY, 2)
    res = client.post("/invoices/billing-run", json={"as_of": as_of.isoformat()}).json()
    assert len(res["created"]) == 3
    assert all(i["issue_date"] == as_of.isoformat() for i in res["created"])
    assert repo.get_subscription(sub["id"])["next_billing_date"] > as_of.isoformat()


# ---------------------------------------------------------------- manual invoices

def test_manual_invoice_prices_lines_and_uses_terms(client, repo):
    res = manual(client, repo, payment_terms_id=repo.net30["id"], issue_date=TODAY.isoformat())
    assert res.status_code == 201, res.text
    inv = res.json()
    assert Decimal(inv["subtotal"]) == Decimal("100")
    assert Decimal(inv["tax_amount"]) == Decimal("18")
    assert Decimal(inv["total_amount"]) == Decimal("118")
    assert inv["due_date"] == (TODAY + timedelta(days=30)).isoformat()
    assert inv["lines"][0]["description"] == "Seat" and inv["created_by"] == str(STAFF.id)


@pytest.mark.parametrize("overrides", [
    {"lines": []},
    {"issue_date": TODAY.isoformat(), "due_date": (TODAY - timedelta(days=1)).isoformat()},
    {"lines": [{"description": "x", "unit_price": "-5"}]},
    {"currency": "inr"},
])
def test_manual_invoice_rejects_invalid_payload(client, repo, overrides):
    assert manual(client, repo, **overrides).status_code == 422


def test_manual_invoice_rejects_bad_references(client, repo):
    other_sub = create(client, repo, customer_id=repo.other_customer["id"]).json()
    for overrides in [{"customer_id": repo.inactive_customer["id"]},
                      {"customer_id": str(uuid.uuid4())},
                      {"subscription_id": other_sub["id"]},
                      {"payment_terms_id": str(uuid.uuid4())}]:
        assert manual(client, repo, **overrides).status_code == 422, overrides
    assert repo.invoices == {}


# ---------------------------------------------------------------- updates

def test_update_draft_lines_and_terms(client, repo):
    inv = manual(client, repo, issue_date=TODAY.isoformat()).json()
    res = client.patch(f"/invoices/{inv['id']}", json={
        "lines": [{"description": "Consulting", "unit_price": "250", "quantity": 2}],
        "payment_terms_id": repo.net30["id"],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert Decimal(body["total_amount"]) == Decimal("500") and body["tax_name"] is None
    assert [l["description"] for l in body["lines"]] == ["Consulting"]
    assert body["due_date"] == (TODAY + timedelta(days=30)).isoformat()


def test_update_rejects_bad_dates_and_empty_lines(client, repo):
    inv = manual(client, repo, issue_date=TODAY.isoformat()).json()
    before = (TODAY - timedelta(days=1)).isoformat()
    assert client.patch(f"/invoices/{inv['id']}", json={"due_date": before}).status_code == 422
    assert client.patch(f"/invoices/{inv['id']}", json={"lines": []}).status_code == 422
    assert client.patch(f"/invoices/{inv['id']}", json={"due_date": None}).status_code == 422
    assert client.patch(f"/invoices/{inv['id']}", json={}).status_code == 422


def test_issued_invoice_only_accepts_notes(client, repo):
    inv = manual(client, repo).json()
    client.post(f"/invoices/{inv['id']}/send")
    assert client.patch(f"/invoices/{inv['id']}", json={"due_date": YEAR_END}).status_code == 409
    res = client.patch(f"/invoices/{inv['id']}", json={"notes": "PO 1234"})
    assert res.status_code == 200 and res.json()["notes"] == "PO 1234"


# ---------------------------------------------------------------- status changes

def test_send_and_zero_total_invoice(client, repo):
    inv = manual(client, repo).json()
    sent = client.post(f"/invoices/{inv['id']}/send").json()
    assert sent["status"] == "sent" and sent["sent_at"]
    assert client.post(f"/invoices/{inv['id']}/send").status_code == 409

    free = manual(client, repo, lines=[{"description": "Free month", "unit_price": "0"}]).json()
    paid = client.post(f"/invoices/{free['id']}/send").json()
    assert paid["status"] == "paid" and paid["paid_at"]


def test_cancel_frees_the_period_for_rebilling(client, repo):
    sub = active_sub(client, repo)
    first = generate(client, sub["id"]).json()
    res = client.post(f"/invoices/{first['id']}/cancel")
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    assert repo.get_subscription(sub["id"])["next_billing_date"] == TODAY.isoformat()
    again = generate(client, sub["id"])
    assert again.status_code == 201
    assert again.json()["billing_period_start"] == first["billing_period_start"]


def test_cancelling_an_older_period_does_not_rewind(client, repo):
    sub = active_sub(client, repo)
    first = generate(client, sub["id"]).json()
    generate(client, sub["id"])
    next_date = repo.get_subscription(sub["id"])["next_billing_date"]
    client.post(f"/invoices/{first['id']}/cancel")
    assert repo.get_subscription(sub["id"])["next_billing_date"] == next_date


def test_void_rules(client, repo):
    inv = manual(client, repo).json()
    assert client.post(f"/invoices/{inv['id']}/void").status_code == 409        # draft: cancel instead
    client.post(f"/invoices/{inv['id']}/send")
    voided = client.post(f"/invoices/{inv['id']}/void").json()
    assert voided["status"] == "void" and voided["voided_at"]
    assert client.post(f"/invoices/{inv['id']}/cancel").status_code == 409

    paid_some = manual(client, repo).json()
    client.post(f"/invoices/{paid_some['id']}/send")
    repo.invoices[paid_some["id"]]["amount_paid"] = "10.00"
    assert client.post(f"/invoices/{paid_some['id']}/void").status_code == 409


def test_mark_overdue(client, repo):
    past = (TODAY - timedelta(days=10)).isoformat()
    overdue = manual(client, repo, issue_date=past, due_date=past).json()
    not_due = manual(client, repo).json()
    draft = manual(client, repo, issue_date=past, due_date=past).json()
    client.post(f"/invoices/{overdue['id']}/send")
    client.post(f"/invoices/{not_due['id']}/send")

    res = client.post("/invoices/mark-overdue")
    assert res.json() == {"marked_overdue": [overdue["id"]]}
    assert client.get(f"/invoices/{draft['id']}").json()["status"] == "draft"
    assert client.post("/invoices/mark-overdue").json() == {"marked_overdue": []}
    assert client.post(f"/invoices/{overdue['id']}/void").json()["status"] == "void"


# ---------------------------------------------------------------- RBAC

def test_customers_see_only_their_issued_invoices(client, repo):
    draft = manual(client, repo).json()
    sent = manual(client, repo).json()
    theirs = manual(client, repo, customer_id=repo.other_customer["id"]).json()
    client.post(f"/invoices/{sent['id']}/send")
    client.post(f"/invoices/{theirs['id']}/send")

    client.as_user(CUSTOMER_USER)
    assert [i["id"] for i in client.get("/invoices").json()] == [sent["id"]]
    assert client.get("/invoices", params={"status": "draft"}).json() == []
    assert client.get(f"/invoices/{sent['id']}").status_code == 200
    assert client.get(f"/invoices/{draft['id']}").status_code == 404
    assert client.get(f"/invoices/{theirs['id']}").status_code == 404


@pytest.mark.parametrize("method,path", [
    ("post", "/invoices"),
    ("post", "/invoices/generate"),
    ("post", "/invoices/billing-run"),
    ("post", "/invoices/mark-overdue"),
    ("patch", f"/invoices/{uuid.uuid4()}"),
    ("post", f"/invoices/{uuid.uuid4()}/send"),
    ("post", f"/invoices/{uuid.uuid4()}/void"),
])
def test_customers_cannot_manage_invoices(client, method, path):
    assert getattr(client.as_user(CUSTOMER_USER), method)(path, json={}).status_code == 403


def test_invoices_require_authentication(repo):
    app.dependency_overrides[get_invoice_repository] = lambda: repo
    try:
        assert TestClient(app).get("/invoices").status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_openapi_documents_invoice_endpoints():
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    for path in ["/invoices", "/invoices/generate", "/invoices/billing-run", "/invoices/mark-overdue",
                 "/invoices/{invoice_id}", "/invoices/{invoice_id}/send",
                 "/invoices/{invoice_id}/cancel", "/invoices/{invoice_id}/void"]:
        assert path in paths, path


# ---------------------------------------------------------------- billing run recovery

def fail_next_subscription_update(repo):
    """Make the next update_subscription call raise, like a dropped connection."""
    original = repo.update_subscription

    def failing(*args, **kwargs):
        repo.update_subscription = original
        raise RuntimeError("connection reset while advancing next_billing_date")

    repo.update_subscription = failing


def test_billing_run_recovers_when_advancing_next_billing_date_failed(client, repo):
    sub = active_sub(client, repo)
    fail_next_subscription_update(repo)

    first = client.post("/invoices/billing-run").json()
    assert len(first["created"]) == 0 and len(repo.invoices) == 1        # invoice saved, date not advanced
    assert [f["subscription_id"] for f in first["failed"]] == [sub["id"]]
    assert "RuntimeError" in first["failed"][0]["reason"]
    assert repo.get_subscription(sub["id"])["next_billing_date"] == TODAY.isoformat()

    second = client.post("/invoices/billing-run").json()
    assert second["created"] == [] and second["failed"] == [] and second["skipped"] == []
    [recovered] = second["recovered"]
    invoice = next(iter(repo.invoices.values()))
    assert recovered["subscription_id"] == sub["id"] and invoice["invoice_number"] in recovered["reason"]
    assert len(repo.invoices) == 1                                       # no duplicate
    assert repo.get_subscription(sub["id"])["next_billing_date"] ==         (date.fromisoformat(invoice["billing_period_end"]) + timedelta(days=1)).isoformat()

    third = client.post("/invoices/billing-run").json()
    assert third == {"created": [], "recovered": [], "skipped": [], "failed": []}


def test_recovery_continues_with_later_missed_periods(client, repo):
    sub = active_sub(client, repo, start_date=(TODAY - timedelta(days=40)).isoformat())
    fail_next_subscription_update(repo)
    client.post("/invoices/billing-run")
    assert len(repo.invoices) == 1

    res = client.post("/invoices/billing-run").json()
    assert len(res["recovered"]) == 1 and len(res["created"]) == 1      # first period recovered, second billed
    periods = sorted((i["billing_period_start"], i["billing_period_end"]) for i in repo.invoices.values())
    assert len(periods) == 2 and periods[0][1] < periods[1][0]           # consecutive, no overlap
    assert repo.get_subscription(sub["id"])["next_billing_date"] > TODAY.isoformat()


def test_generate_endpoint_also_recovers(client, repo):
    sub = active_sub(client, repo)
    fail_next_subscription_update(repo)
    with pytest.raises(RuntimeError):
        generate(client, sub["id"])
    stuck = generate(client, sub["id"])
    assert stuck.status_code == 409 and "INV-" in stuck.json()["detail"]
    nxt = generate(client, sub["id"])                                    # bills the following period
    assert nxt.status_code == 201 and nxt.json()["billing_period_start"] > TODAY.isoformat()
    assert len(repo.invoices) == 2


def test_concurrent_run_hitting_unique_index_advances_and_recovers(client, repo):
    sub = active_sub(client, repo)
    generate(client, sub["id"])
    repo.subscriptions[sub["id"]]["next_billing_date"] = TODAY.isoformat()   # other run hasn't advanced yet
    original, calls = repo.find_live_invoice, {"n": 0}

    def stale_first_read(*args):        # our pre-check misses the other run's invoice
        calls["n"] += 1
        return None if calls["n"] == 1 else original(*args)

    repo.find_live_invoice = stale_first_read
    res = client.post("/invoices/billing-run").json()
    assert len(res["recovered"]) == 1 and res["created"] == [] and res["failed"] == []
    assert len(repo.invoices) == 1
    assert repo.get_subscription(sub["id"])["next_billing_date"] > TODAY.isoformat()


def test_one_failing_subscription_does_not_stop_the_run(client, repo):
    good_a = active_sub(client, repo)
    broken = active_sub(client, repo)
    no_lines = active_sub(client, repo)
    good_b = active_sub(client, repo)
    repo.lines = {k: v for k, v in repo.lines.items() if v["subscription_id"] != no_lines["id"]}
    original = repo.list_lines

    def list_lines(subscription_id):
        if str(subscription_id) == broken["id"]:
            raise RuntimeError("timeout reading subscription_lines")
        return original(subscription_id)

    repo.list_lines = list_lines
    res = client.post("/invoices/billing-run")
    assert res.status_code == 200
    body = res.json()
    assert {i["subscription_id"] for i in body["created"]} == {good_a["id"], good_b["id"]}
    assert [(f["subscription_id"], "timeout" in f["reason"]) for f in body["failed"]] == [(broken["id"], True)]
    assert [s["subscription_id"] for s in body["skipped"]] == [no_lines["id"]]
    assert repo.get_subscription(broken["id"])["next_billing_date"] == TODAY.isoformat()   # retried next run


# ---------------------------------------------------------------- schema contract

def test_invoice_flows_write_only_real_columns(client, repo):
    sub = active_sub(client, repo, payment_terms_id=repo.net30["id"],
                     lines=[{"variant_id": repo.variant["id"], "tax_id": repo.gst["id"]}])
    generated = generate(client, sub["id"]).json()
    client.post(f"/invoices/{generated['id']}/cancel")
    client.post("/invoices/billing-run")
    inv = manual(client, repo, subscription_id=sub["id"]).json()
    client.patch(f"/invoices/{inv['id']}", json={"payment_terms_id": repo.net30["id"], "notes": "n",
                                                  "lines": [{"description": "x", "unit_price": "5"}]})
    client.post(f"/invoices/{inv['id']}/send")
    client.post("/invoices/mark-overdue", params={"as_of": (TODAY + timedelta(days=60)).isoformat()})
    client.post(f"/invoices/{inv['id']}/void")
    assert {t for t, _, _ in repo.writes} >= {"invoices", "invoice_lines", "subscriptions"}
    assert_writes_match_schema(repo.writes)


def test_concurrent_invoice_edit_is_rejected_and_cleaned_up(client, repo):
    inv = manual(client, repo).json()
    original_insert = repo.insert_invoice_lines

    def someone_saves_first(lines):
        rows = original_insert(lines)
        repo.invoices[inv["id"]]["updated_at"] = "2099-01-01T00:00:00+00:00"
        return rows

    repo.insert_invoice_lines = someone_saves_first
    res = client.patch(f"/invoices/{inv['id']}", json={"lines": [{"description": "Mine", "unit_price": "1"}]})
    assert res.status_code == 409
    assert [l["description"] for l in repo.list_invoice_lines(inv["id"])] == ["Seat"]

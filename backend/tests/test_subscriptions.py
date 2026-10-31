import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.current_user import CurrentUser, Role, get_current_user
from app.main import app
from app.repositories.subscription_repository import get_subscription_repository
from app.services.subscription_service import price_line
from subscription_fakes import FakeSubscriptionRepository

TODAY = date.today()
STAFF = CurrentUser(id=uuid.uuid4(), role=Role.STAFF)
ADMIN = CurrentUser(id=uuid.uuid4(), role=Role.ADMIN)
CUSTOMER_USER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)
OTHER_CUSTOMER_USER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)


@pytest.fixture
def repo():
    r = FakeSubscriptionRepository()
    r.customer = r.add(r.customers, name="Acme", auth_user_id=str(CUSTOMER_USER.id))
    r.other_customer = r.add(r.customers, name="Globex", auth_user_id=str(OTHER_CUSTOMER_USER.id))
    r.inactive_customer = r.add(r.customers, name="Gone", is_active=False)
    r.plan = r.add(r.plans, name="Pro Monthly", interval="monthly", price=100, min_quantity=1,
                   pausable=True, closable_early=True, renewable=True)
    r.strict_plan = r.add(r.plans, name="Locked Yearly", interval="yearly", price=1000, min_quantity=5,
                          pausable=False, closable_early=False, renewable=False)
    r.product = r.add(r.products, name="Seat", price=50)
    r.variant = r.add(r.variants, product_id=r.product["id"], name="Premium", extra_price=25)
    r.other_product = r.add(r.products, name="Storage", price=10)
    r.gst = r.add(r.taxes, name="GST", rate=18)
    return r


@pytest.fixture
def client(repo):
    state = {"user": STAFF}
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    class Client(TestClient):
        def as_user(self, user):
            state["user"] = user
            return self

    yield Client(app)
    app.dependency_overrides.clear()


def create(client, repo, **overrides):
    body = {"customer_id": repo.customer["id"], "plan_id": repo.plan["id"], "quantity": 2,
            "start_date": TODAY.isoformat(), "end_date": (TODAY + timedelta(days=30)).isoformat()}
    body.update(overrides)
    return client.post("/subscriptions", json=body)


def advance(client, sub_id, *actions):
    for action in actions:
        res = client.post(f"/subscriptions/{sub_id}/{action}")
        assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------- pricing

def test_price_line_discount_then_tax():
    result = price_line(2, "100.00", 10, 18)
    assert result == {"subtotal": Decimal("200.00"), "discount_amount": Decimal("20.00"),
                      "tax_amount": Decimal("32.40"), "line_total": Decimal("212.40")}


def test_price_line_without_tax_rounds_half_up():
    assert price_line("3", "33.335", 0)["line_total"] == Decimal("100.01")


# ---------------------------------------------------------------- auth

def test_requests_without_token_get_401(repo):
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    try:
        res = TestClient(app).get("/subscriptions")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 401


def test_auth_placeholder_fails_closed_with_token(repo):
    app.dependency_overrides[get_subscription_repository] = lambda: repo
    try:
        res = TestClient(app).get("/subscriptions", headers={"Authorization": "Bearer anything"})
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503


@pytest.mark.parametrize("method,path", [
    ("post", "/subscriptions"),
    ("patch", f"/subscriptions/{uuid.uuid4()}"),
    ("post", f"/subscriptions/{uuid.uuid4()}/activate"),
    ("post", f"/subscriptions/{uuid.uuid4()}/renew"),
])
def test_customer_cannot_manage_subscriptions(client, method, path):
    res = getattr(client.as_user(CUSTOMER_USER), method)(path, json={})
    assert res.status_code == 403


# ---------------------------------------------------------------- create

def test_create_without_lines_uses_plan(client, repo):
    res = create(client, repo)
    assert res.status_code == 201, res.text
    sub = res.json()
    assert sub["status"] == "draft"
    assert sub["subscription_number"].startswith("SUB-")
    assert sub["created_by"] == str(STAFF.id)
    assert sub["next_billing_date"] == TODAY.isoformat()
    assert Decimal(sub["unit_price"]) == Decimal("100")
    assert Decimal(sub["total_amount"]) == Decimal("200")
    assert len(sub["lines"]) == 1 and sub["lines"][0]["description"] == "Pro Monthly"
    assert [h["to_status"] for h in repo.history] == ["draft"]


def test_create_with_product_variant_and_tax_lines(client, repo):
    res = create(client, repo, lines=[
        {"variant_id": repo.variant["id"], "quantity": 2, "tax_id": repo.gst["id"], "discount_percent": 10},
        {"description": "Setup fee", "unit_price": "40.00"},
    ])
    assert res.status_code == 201, res.text
    sub = res.json()
    first, second = sub["lines"]
    assert first["product_id"] == repo.product["id"]       # taken from the variant
    assert first["description"] == "Seat - Premium"
    assert Decimal(first["unit_price"]) == Decimal("75")     # 50 + 25 extra
    assert Decimal(first["line_total"]) == Decimal("159.30")  # 150 - 15 + 18% of 135
    assert Decimal(second["line_total"]) == Decimal("40")
    assert Decimal(sub["discount_amount"]) == Decimal("15")
    assert Decimal(sub["tax_amount"]) == Decimal("24.30")
    assert Decimal(sub["total_amount"]) == Decimal("199.30")


def test_trial_moves_first_billing_date(client, repo):
    trial_end = TODAY + timedelta(days=7)
    sub = create(client, repo, trial_end_date=trial_end.isoformat()).json()
    assert sub["next_billing_date"] == (trial_end + timedelta(days=1)).isoformat()


@pytest.mark.parametrize("overrides", [
    {"end_date": TODAY.isoformat()},                                    # end == start
    {"quantity": 0},
    {"quantity": -1},
    {"trial_end_date": (TODAY - timedelta(days=1)).isoformat()},
    {"currency": "rupees"},
    {"lines": [{"description": "Manual line without price"}]},
    {"lines": [{"description": "Negative", "unit_price": "-1"}]},
    {"lines": [{"description": "Bad discount", "unit_price": "1", "discount_percent": 101}]},
    {"unknown_field": True},
])
def test_create_rejects_invalid_payload(client, repo, overrides):
    assert create(client, repo, **overrides).status_code == 422


def test_create_rejects_bad_references(client, repo):
    cases = [
        {"plan_id": str(uuid.uuid4())},
        {"customer_id": str(uuid.uuid4())},
        {"customer_id": repo.inactive_customer["id"]},
        {"plan_id": repo.strict_plan["id"], "quantity": 4},             # below min_quantity 5
        {"payment_terms_id": str(uuid.uuid4())},
        {"lines": [{"product_id": repo.other_product["id"], "variant_id": repo.variant["id"]}]},
        {"lines": [{"product_id": str(uuid.uuid4())}]},
        {"lines": [{"description": "x", "unit_price": "1", "tax_id": str(uuid.uuid4())}]},
    ]
    for overrides in cases:
        res = create(client, repo, **overrides)
        assert res.status_code == 422, (overrides, res.text)
    assert repo.subscriptions == {}


def test_create_rolls_back_header_when_lines_fail(client, repo):
    repo.fail_line_insert = True
    with pytest.raises(RuntimeError):
        create(client, repo)
    assert repo.subscriptions == {}


# ---------------------------------------------------------------- read

def test_get_and_list_respect_customer_ownership(client, repo):
    mine = create(client, repo).json()
    theirs = create(client, repo, customer_id=repo.other_customer["id"]).json()

    client.as_user(CUSTOMER_USER)
    assert client.get(f"/subscriptions/{mine['id']}").status_code == 200
    assert client.get(f"/subscriptions/{theirs['id']}").status_code == 404
    listed = client.get("/subscriptions", params={"customer_id": repo.other_customer["id"]}).json()
    assert [s["id"] for s in listed] == [mine["id"]]

    client.as_user(STAFF)
    assert len(client.get("/subscriptions").json()) == 2


def test_list_filters_by_status(client, repo):
    a = create(client, repo).json()
    create(client, repo)
    advance(client, a["id"], "confirm")
    res = client.get("/subscriptions", params={"status": "confirmed"})
    assert [s["id"] for s in res.json()] == [a["id"]]
    assert client.get("/subscriptions", params={"status": "bogus"}).status_code == 422


def test_get_unknown_or_malformed_id(client):
    assert client.get(f"/subscriptions/{uuid.uuid4()}").status_code == 404
    assert client.get("/subscriptions/not-a-uuid").status_code == 422


# ---------------------------------------------------------------- update

def test_update_quantity_reprices_plan_line_and_keeps_product_lines(client, repo):
    sub = create(client, repo, lines=[
        {"description": "Pro Monthly", "unit_price": "100", "quantity": 2},
        {"product_id": repo.product["id"]},
    ]).json()
    res = client.patch(f"/subscriptions/{sub['id']}", json={"quantity": 3})
    assert res.status_code == 200, res.text
    lines = res.json()["lines"]
    assert [Decimal(l["line_total"]) for l in lines] == [Decimal("300"), Decimal("50")]
    assert Decimal(res.json()["total_amount"]) == Decimal("350")


def test_update_replaces_lines(client, repo):
    sub = create(client, repo).json()
    res = client.patch(f"/subscriptions/{sub['id']}",
                       json={"lines": [{"description": "Custom", "unit_price": "12.50", "quantity": 4}]})
    assert res.status_code == 200
    assert [l["description"] for l in res.json()["lines"]] == ["Custom"]
    assert Decimal(res.json()["total_amount"]) == Decimal("50")


def test_update_validates_merged_dates_and_nulls(client, repo):
    sub = create(client, repo).json()
    past_end = (TODAY - timedelta(days=1)).isoformat()
    assert client.patch(f"/subscriptions/{sub['id']}", json={"end_date": past_end}).status_code == 422
    assert client.patch(f"/subscriptions/{sub['id']}", json={"plan_id": None}).status_code == 422
    assert client.patch(f"/subscriptions/{sub['id']}", json={}).status_code == 422
    open_ended = client.patch(f"/subscriptions/{sub['id']}", json={"end_date": None})
    assert open_ended.status_code == 200 and open_ended.json()["end_date"] is None


def test_update_after_confirmation_only_allows_notes(client, repo):
    sub = create(client, repo).json()
    advance(client, sub["id"], "confirm")
    assert client.patch(f"/subscriptions/{sub['id']}", json={"quantity": 5}).status_code == 409
    res = client.patch(f"/subscriptions/{sub['id']}", json={"notes": "VIP", "auto_renew": False})
    assert res.status_code == 200
    assert res.json()["notes"] == "VIP" and res.json()["auto_renew"] is False


# ---------------------------------------------------------------- lifecycle

def test_full_lifecycle_records_history(client, repo):
    sub = create(client, repo).json()
    quoted = advance(client, sub["id"], "send-quotation")
    assert quoted["status"] == "quotation"
    assert quoted["quotation_number"] == "QUO-" + sub["subscription_number"].split("-")[1]

    confirmed = advance(client, sub["id"], "confirm")
    assert confirmed["confirmed_at"]

    advance(client, sub["id"], "activate")
    paused = client.post(f"/subscriptions/{sub['id']}/pause", json={"reason": "Holiday"}).json()
    assert paused["status"] == "paused" and paused["pause_reason"] == "Holiday"

    resumed = advance(client, sub["id"], "resume")
    assert resumed["status"] == "active" and resumed["paused_at"] is None

    closed = client.post(f"/subscriptions/{sub['id']}/close", json={"reason": "Churned"}).json()
    assert closed["status"] == "closed" and closed["close_reason"] == "Churned"
    assert closed["next_billing_date"] is None

    history = client.get(f"/subscriptions/{sub['id']}/history").json()
    assert [(h["from_status"], h["to_status"]) for h in history] == [
        (None, "draft"), ("draft", "quotation"), ("quotation", "confirmed"), ("confirmed", "active"),
        ("active", "paused"), ("paused", "active"), ("active", "closed"),
    ]
    assert history[-1]["changed_by"] == str(STAFF.id)


@pytest.mark.parametrize("setup,action", [
    ([], "activate"),                                   # draft cannot skip confirm
    ([], "pause"),
    ([], "resume"),
    (["confirm", "activate"], "confirm"),
    (["confirm", "activate"], "resume"),
    (["close"], "close"),                               # closed is terminal
    (["close"], "send-quotation"),
])
def test_invalid_transitions_return_409(client, repo, setup, action):
    sub = create(client, repo).json()
    advance(client, sub["id"], *setup) if setup else None
    assert client.post(f"/subscriptions/{sub['id']}/{action}").status_code == 409


def test_plan_flags_block_pause_and_early_close(client, repo):
    sub = create(client, repo, plan_id=repo.strict_plan["id"], quantity=5).json()
    advance(client, sub["id"], "confirm", "activate")
    assert client.post(f"/subscriptions/{sub['id']}/pause").status_code == 409
    assert client.post(f"/subscriptions/{sub['id']}/close").status_code == 409


def test_drafts_can_always_be_cancelled(client, repo):
    sub = create(client, repo, plan_id=repo.strict_plan["id"], quantity=5).json()
    assert client.post(f"/subscriptions/{sub['id']}/close").json()["status"] == "closed"


def test_customer_can_accept_only_own_quotation(client, repo):
    mine = create(client, repo).json()
    theirs = create(client, repo, customer_id=repo.other_customer["id"]).json()
    client.post(f"/subscriptions/{theirs['id']}/send-quotation")

    client.as_user(CUSTOMER_USER)
    assert client.post(f"/subscriptions/{mine['id']}/confirm").status_code == 409   # still draft
    assert client.post(f"/subscriptions/{theirs['id']}/confirm").status_code == 404
    client.as_user(STAFF).post(f"/subscriptions/{mine['id']}/send-quotation")
    res = client.as_user(CUSTOMER_USER).post(f"/subscriptions/{mine['id']}/confirm")
    assert res.status_code == 200 and res.json()["status"] == "confirmed"


def test_concurrent_status_change_returns_409(client, repo):
    sub = create(client, repo).json()
    original = repo.get_subscription
    # Simulate another request confirming it between our read and our write.
    repo.get_subscription = lambda sid: {**original(sid), "status": "draft"}
    repo.subscriptions[sub["id"]]["status"] = "confirmed"
    assert client.post(f"/subscriptions/{sub['id']}/send-quotation").status_code == 409


# ---------------------------------------------------------------- renewal

def test_renew_extends_by_term_length(client, repo):
    sub = create(client, repo).json()
    advance(client, sub["id"], "confirm", "activate")
    res = client.post(f"/subscriptions/{sub['id']}/renew")
    assert res.status_code == 200, res.text
    assert res.json()["end_date"] == (TODAY + timedelta(days=60)).isoformat()
    assert res.json()["status"] == "active"
    assert repo.history[-1]["metadata"]["action"] == "renew"


def test_renew_to_explicit_date(client, repo):
    sub = create(client, repo).json()
    advance(client, sub["id"], "confirm", "activate")
    new_end = (TODAY + timedelta(days=365)).isoformat()
    res = client.post(f"/subscriptions/{sub['id']}/renew", json={"new_end_date": new_end})
    assert res.json()["end_date"] == new_end
    earlier = (TODAY + timedelta(days=10)).isoformat()
    res = client.post(f"/subscriptions/{sub['id']}/renew", json={"new_end_date": earlier})
    assert res.status_code == 422


def test_renew_rules(client, repo):
    draft = create(client, repo).json()
    assert client.post(f"/subscriptions/{draft['id']}/renew").status_code == 409

    open_ended = create(client, repo, end_date=None).json()
    advance(client, open_ended["id"], "confirm", "activate")
    assert client.post(f"/subscriptions/{open_ended['id']}/renew").status_code == 409

    locked = create(client, repo, plan_id=repo.strict_plan["id"], quantity=5).json()
    advance(client, locked["id"], "confirm", "activate")
    assert client.post(f"/subscriptions/{locked['id']}/renew").status_code == 409


def test_openapi_documents_all_endpoints():
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    for action in ["send-quotation", "confirm", "activate", "pause", "resume", "close", "renew"]:
        assert f"/subscriptions/{{subscription_id}}/{action}" in paths
    assert {"get", "post"} <= set(paths["/subscriptions"])
    assert {"get", "patch"} <= set(paths["/subscriptions/{subscription_id}"])

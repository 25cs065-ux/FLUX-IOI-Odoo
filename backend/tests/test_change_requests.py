"""Change requests API against an in-memory repository shaped like the live table."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.current_user import CurrentUser, Role, get_current_user
from app.main import app
from app.repositories.change_request_repository import get_change_request_repository

# Columns of the live public.change_requests table.
LIVE_COLUMNS = {"id", "customer_id", "subscription_id", "request_type", "details", "status",
                "created_at", "updated_at"}

ADMIN = CurrentUser(id=uuid.uuid4(), role=Role.ADMIN)
STAFF = CurrentUser(id=uuid.uuid4(), role=Role.STAFF)
CUSTOMER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)
OTHER_CUSTOMER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)
UNLINKED_CUSTOMER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)


class FakeChangeRequestRepository:
    def __init__(self):
        self.customers, self.subscriptions, self.requests = {}, {}, {}

    def add_customer(self, auth_user_id, is_active=True):
        row = {"id": str(uuid.uuid4()), "auth_user_id": str(auth_user_id), "is_active": is_active}
        self.customers[row["id"]] = row
        return row

    def add_subscription(self, customer_id):
        row = {"id": str(uuid.uuid4()), "customer_id": customer_id}
        self.subscriptions[row["id"]] = row
        return row

    def get_customer(self, customer_id):
        return self.customers.get(str(customer_id))

    def get_customer_by_auth_user(self, auth_user_id):
        return next((c for c in self.customers.values() if c["auth_user_id"] == str(auth_user_id)), None)

    def get_subscription(self, subscription_id):
        return self.subscriptions.get(str(subscription_id))

    def get_request(self, request_id):
        return self.requests.get(str(request_id))

    def list_requests(self, *, customer_id=None, subscription_id=None, status=None, limit=50, offset=0):
        rows = [r for r in self.requests.values()
                if (customer_id is None or r["customer_id"] == str(customer_id))
                and (subscription_id is None or r["subscription_id"] == str(subscription_id))
                and (status is None or r["status"] == status)]
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        return rows[offset:offset + limit]

    def insert_request(self, data):
        assert set(data) <= LIVE_COLUMNS, set(data) - LIVE_COLUMNS
        now = datetime.now(timezone.utc).isoformat()
        row = {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now, "details": None,
               "subscription_id": None, "status": "pending"}
        row.update({k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in data.items()})
        self.requests[row["id"]] = row
        return dict(row)

    def update_request(self, request_id, data):
        assert set(data) <= LIVE_COLUMNS, set(data) - LIVE_COLUMNS
        row = self.requests.get(str(request_id))
        if row:
            row.update({k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in data.items()})
        return dict(row) if row else None


@pytest.fixture
def repo():
    r = FakeChangeRequestRepository()
    r.customer = r.add_customer(CUSTOMER.id)
    r.other = r.add_customer(OTHER_CUSTOMER.id)
    r.sub = r.add_subscription(r.customer["id"])
    r.other_sub = r.add_subscription(r.other["id"])
    return r


@pytest.fixture
def client(repo):
    state = {"user": CUSTOMER}
    app.dependency_overrides[get_change_request_repository] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    class Client(TestClient):
        def as_user(self, user):
            state["user"] = user
            return self

    yield Client(app)
    app.dependency_overrides.clear()


def body(**overrides):
    data = {"request_type": "upgrade", "details": "Please move us to the annual plan"}
    data.update(overrides)
    return data


# ---------------------------------------------------------------- create

def test_customer_creates_request_for_own_subscription(client, repo):
    res = client.post("/change-requests/", json=body(subscription_id=repo.sub["id"]))
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["customer_id"] == repo.customer["id"]
    assert data["subscription_id"] == repo.sub["id"]
    assert data["status"] == "pending" and data["request_type"] == "upgrade"


def test_customer_cannot_choose_another_customer(client, repo):
    res = client.post("/change-requests/", json=body(customer_id=repo.other["id"]))
    assert res.status_code == 201
    assert res.json()["customer_id"] == repo.customer["id"]      # always their own


def test_customer_cannot_use_someone_elses_subscription(client, repo):
    res = client.post("/change-requests/", json=body(subscription_id=repo.other_sub["id"]))
    assert res.status_code == 422
    assert not repo.requests


def test_customer_without_customer_record_is_refused(client):
    assert client.as_user(UNLINKED_CUSTOMER).post("/change-requests/", json=body()).status_code == 403


def test_staff_must_name_an_active_customer(client, repo):
    client.as_user(STAFF)
    assert client.post("/change-requests/", json=body()).status_code == 422
    assert client.post("/change-requests/", json=body(customer_id=str(uuid.uuid4()))).status_code == 422
    res = client.post("/change-requests/", json=body(customer_id=repo.other["id"],
                                                     subscription_id=repo.other_sub["id"]))
    assert res.status_code == 201
    assert res.json()["customer_id"] == repo.other["id"]


@pytest.mark.parametrize("bad", [
    {"request_type": "teleport"},
    {"details": "too short"},
    {"reason": "unknown field from the old schema"},
])
def test_invalid_payloads_rejected(client, bad):
    assert client.post("/change-requests/", json=body(**bad)).status_code == 422


# ---------------------------------------------------------------- read

def test_list_is_scoped_for_customers_and_complete_for_staff(client, repo):
    client.post("/change-requests/", json=body())
    client.as_user(OTHER_CUSTOMER).post("/change-requests/", json=body(request_type="downgrade"))

    mine = client.as_user(CUSTOMER).get("/change-requests/").json()
    assert [r["customer_id"] for r in mine] == [repo.customer["id"]]
    # A customer cannot widen the list with customer_id.
    assert len(client.get(f"/change-requests/?customer_id={repo.other['id']}").json()) == 1

    assert len(client.as_user(STAFF).get("/change-requests/").json()) == 2
    assert len(client.get("/change-requests/?status=pending").json()) == 2
    assert client.get("/change-requests/?status=approved").json() == []
    assert len(client.get(f"/change-requests/?customer_id={repo.other['id']}").json()) == 1


def test_unlinked_customer_gets_empty_list(client):
    res = client.as_user(UNLINKED_CUSTOMER).get("/change-requests/")
    assert res.status_code == 200 and res.json() == []


def test_customer_cannot_read_another_customers_request(client, repo):
    other_id = client.as_user(OTHER_CUSTOMER).post("/change-requests/", json=body()).json()["id"]
    assert client.as_user(CUSTOMER).get(f"/change-requests/{other_id}").status_code == 404
    assert client.as_user(STAFF).get(f"/change-requests/{other_id}").status_code == 200


def test_bad_or_missing_ids(client):
    assert client.get("/change-requests/not-a-uuid").status_code == 422
    assert client.get(f"/change-requests/{uuid.uuid4()}").status_code == 404


# ---------------------------------------------------------------- status changes

def test_only_admin_changes_status_and_terminal_states_are_final(client):
    request_id = client.post("/change-requests/", json=body()).json()["id"]
    assert client.patch(f"/change-requests/{request_id}", json={"status": "approved"}).status_code == 403
    assert client.as_user(STAFF).patch(f"/change-requests/{request_id}",
                                       json={"status": "approved"}).status_code == 403

    client.as_user(ADMIN)
    res = client.patch(f"/change-requests/{request_id}", json={"status": "under_review"})
    assert res.status_code == 200 and res.json()["status"] == "under_review"
    assert client.patch(f"/change-requests/{request_id}", json={"status": "approved"}).status_code == 200
    assert client.patch(f"/change-requests/{request_id}", json={"status": "pending"}).status_code == 409
    assert client.patch(f"/change-requests/{request_id}", json={"status": "bogus"}).status_code == 422
    assert client.patch(f"/change-requests/{uuid.uuid4()}", json={"status": "approved"}).status_code == 404


def test_requires_a_token():
    app.dependency_overrides.clear()
    anon = TestClient(app)
    assert anon.get("/change-requests/").status_code == 401
    assert anon.post("/change-requests/", json=body()).status_code == 401
    assert anon.patch(f"/change-requests/{uuid.uuid4()}", json={"status": "approved"}).status_code == 401

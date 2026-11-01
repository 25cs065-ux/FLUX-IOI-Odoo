"""Quotation templates and products APIs against in-memory fakes shaped like the live tables."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.schemas.quotation_template as schemas
from app.core.current_user import CurrentUser, Role, get_current_user
from app.main import app
from app.repositories.quotation_template_repository import (
    flatten_template,
    get_quotation_template_repository,
)
from app.routers.products import get_product_lister

TEMPLATE_COLUMNS = {"id", "name", "plan_id", "validity_days", "is_active", "created_at"}
LINE_COLUMNS = {"id", "template_id", "product_id", "variant_id", "quantity"}

ADMIN = CurrentUser(id=uuid.uuid4(), role=Role.ADMIN)
STAFF = CurrentUser(id=uuid.uuid4(), role=Role.STAFF)
CUSTOMER = CurrentUser(id=uuid.uuid4(), role=Role.CUSTOMER)


def new_id():
    return str(uuid.uuid4())


class FakeTemplateRepository:
    def __init__(self):
        self.plans, self.products, self.variants = {}, {}, {}
        self.templates, self.lines = {}, {}
        self.fail_lines = False

    def add(self, table, **row):
        row.setdefault("id", new_id())
        row.setdefault("is_active", True)
        table[row["id"]] = row
        return row

    def get_plan(self, plan_id):
        return self.plans.get(str(plan_id))

    def get_product(self, product_id):
        return self.products.get(str(product_id))

    def get_variant(self, variant_id):
        return self.variants.get(str(variant_id))

    def _embedded(self, row):
        # Same shape PostgREST returns for TEMPLATE_SELECT, then flattened like the real repository.
        embedded = dict(row)
        embedded["plans"] = {"name": self.plans[row["plan_id"]]["name"]} if row.get("plan_id") else None
        embedded["quotation_template_lines"] = [
            {**line,
             "products": {"name": self.products[line["product_id"]]["name"]},
             "variants": {"name": self.variants[line["variant_id"]]["name"]} if line.get("variant_id") else None}
            for line in self.lines.values() if line["template_id"] == row["id"]
        ]
        return flatten_template(embedded)

    def list_templates(self, *, is_active=None):
        rows = [r for r in self.templates.values() if is_active is None or r["is_active"] == is_active]
        return [self._embedded(r) for r in sorted(rows, key=lambda r: r["created_at"], reverse=True)]

    def get_template(self, template_id):
        row = self.templates.get(str(template_id))
        return self._embedded(row) if row else None

    def insert_template(self, data):
        assert set(data) <= TEMPLATE_COLUMNS, set(data) - TEMPLATE_COLUMNS
        row = {"id": new_id(), "created_at": datetime.now(timezone.utc).isoformat(), "validity_days": 30,
               "is_active": True, "plan_id": None}
        row.update({k: str(v) if isinstance(v, uuid.UUID) else v for k, v in data.items()})
        self.templates[row["id"]] = row
        return dict(row)

    def insert_lines(self, rows):
        if self.fail_lines:
            raise RuntimeError("lines table unavailable")
        out = []
        for data in rows:
            assert set(data) <= LINE_COLUMNS, set(data) - LINE_COLUMNS
            row = {"id": new_id(), "variant_id": None, "quantity": 1}
            row.update({k: str(v) if isinstance(v, uuid.UUID) else v for k, v in data.items()})
            self.lines[row["id"]] = row
            out.append(row)
        return out

    def update_template(self, template_id, data):
        assert set(data) <= TEMPLATE_COLUMNS, set(data) - TEMPLATE_COLUMNS
        row = self.templates.get(str(template_id))
        if row:
            row.update({k: str(v) if isinstance(v, uuid.UUID) else v for k, v in data.items()})
        return row

    def delete_template(self, template_id):
        self.lines = {k: v for k, v in self.lines.items() if v["template_id"] != str(template_id)}
        self.templates.pop(str(template_id), None)


@pytest.fixture
def repo():
    r = FakeTemplateRepository()
    r.plan = r.add(r.plans, name="Pro Monthly")
    r.old_plan = r.add(r.plans, name="Legacy", is_active=False)
    r.product = r.add(r.products, name="Analytics Suite")
    r.other_product = r.add(r.products, name="Support Pack")
    r.variant = r.add(r.variants, name="Enterprise", product_id=r.product["id"])
    return r


@pytest.fixture
def client(repo):
    state = {"user": ADMIN}
    app.dependency_overrides[get_quotation_template_repository] = lambda: repo
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    class Client(TestClient):
        def as_user(self, user):
            state["user"] = user
            return self

    yield Client(app)
    app.dependency_overrides.clear()


def body(repo, **overrides):
    data = {"name": "Enterprise Proposal", "validity_days": 45, "plan_id": repo.plan["id"], "is_active": True,
            "lines": [{"product_id": repo.product["id"], "variant_id": repo.variant["id"], "quantity": 3},
                      {"product_id": repo.other_product["id"], "quantity": 1}]}
    data.update(overrides)
    return data


# ------------------------------------------------------------------ schema

def test_schema_matches_live_columns():
    assert set(schemas.QuotationTemplateCreate.model_fields) == {"name", "validity_days", "plan_id", "is_active", "lines"}
    assert set(schemas.TemplateLineCreate.model_fields) == {"product_id", "variant_id", "quantity"}


@pytest.mark.parametrize("bad", [
    {"validity_days": 0}, {"validity_days": -5}, {"name": "x"},
    {"terms_and_conditions": "not a column in the live table"},
])
def test_invalid_template_payloads(bad):
    with pytest.raises(ValidationError):
        schemas.QuotationTemplateCreate(**{"name": "Valid name", **bad})


def test_invalid_line_payloads():
    with pytest.raises(ValidationError):
        schemas.TemplateLineCreate(product_id=new_id(), quantity=0)
    with pytest.raises(ValidationError):
        schemas.TemplateLineCreate(product_id=new_id(), unit_price=10)


# ------------------------------------------------------------------ create

def test_admin_creates_template_with_lines_and_names(client, repo):
    res = client.post("/quotation-templates/", json=body(repo))
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["name"] == "Enterprise Proposal" and data["validity_days"] == 45 and data["is_active"]
    assert data["plan_id"] == repo.plan["id"] and data["plan_name"] == "Pro Monthly"
    lines = sorted(data["lines"], key=lambda line: line["quantity"])
    assert [(l["product_name"], l["variant_name"], l["quantity"]) for l in lines] == [
        ("Support Pack", None, 1), ("Analytics Suite", "Enterprise", 3)]
    # The new template is returned by the list straight away.
    assert [t["id"] for t in client.get("/quotation-templates/").json()] == [data["id"]]


def test_template_without_plan_or_lines(client, repo):
    res = client.post("/quotation-templates/", json={"name": "Blank quote"})
    assert res.status_code == 201, res.text
    assert res.json()["validity_days"] == 30 and res.json()["lines"] == [] and res.json()["plan_name"] is None


@pytest.mark.parametrize("change,detail", [
    ({"plan_id": "OLD"}, "Plan not found or inactive"),
    ({"plan_id": "MISSING"}, "Plan not found or inactive"),
    ({"lines": [{"product_id": "MISSING"}]}, "Line 1: product not found"),
    ({"lines": [{"product_id": "OTHER", "variant_id": "VARIANT"}]}, "Line 1: variant not found"),
])
def test_bad_references_are_rejected_before_writing(client, repo, change, detail):
    ids = {"OLD": repo.old_plan["id"], "MISSING": new_id(), "OTHER": repo.other_product["id"],
           "VARIANT": repo.variant["id"]}
    resolved = {k: ([{f: ids.get(v, v) for f, v in line.items()} for line in v] if k == "lines" else ids[v])
                for k, v in change.items()}
    res = client.post("/quotation-templates/", json=body(repo, **resolved))
    assert res.status_code == 422 and detail in res.json()["detail"]
    assert repo.templates == {} and repo.lines == {}


def test_failed_lines_remove_the_template(client, repo):
    repo.fail_lines = True
    res = client.post("/quotation-templates/", json=body(repo))
    assert res.status_code == 502
    assert repo.templates == {} and repo.lines == {}


@pytest.mark.parametrize("user,code", [(STAFF, 403), (CUSTOMER, 403)])
def test_only_admin_creates(client, repo, user, code):
    assert client.as_user(user).post("/quotation-templates/", json=body(repo)).status_code == code
    assert repo.templates == {}


def test_create_requires_a_token(repo):
    app.dependency_overrides.clear()
    app.dependency_overrides[get_quotation_template_repository] = lambda: repo
    try:
        assert TestClient(app).post("/quotation-templates/", json={"name": "Nope"}).status_code == 401
    finally:
        app.dependency_overrides.clear()


# ------------------------------------------------------------------ read, filter, update

def test_list_filter_details_and_update(client, repo):
    active = client.post("/quotation-templates/", json=body(repo)).json()
    inactive = client.post("/quotation-templates/", json=body(repo, name="Old offer", is_active=False)).json()

    assert {t["id"] for t in client.get("/quotation-templates/").json()} == {active["id"], inactive["id"]}
    assert [t["id"] for t in client.get("/quotation-templates/?is_active=true").json()] == [active["id"]]
    assert [t["id"] for t in client.get("/quotation-templates/?is_active=false").json()] == [inactive["id"]]

    detail = client.as_user(CUSTOMER).get(f"/quotation-templates/{active['id']}")
    assert detail.status_code == 200 and len(detail.json()["lines"]) == 2

    client.as_user(ADMIN)
    res = client.patch(f"/quotation-templates/{active['id']}", json={"is_active": False, "validity_days": 10})
    assert res.status_code == 200 and res.json()["is_active"] is False and res.json()["validity_days"] == 10
    assert client.patch(f"/quotation-templates/{active['id']}", json={}).status_code == 400
    assert client.patch(f"/quotation-templates/{new_id()}", json={"is_active": True}).status_code == 404
    assert client.as_user(STAFF).patch(f"/quotation-templates/{active['id']}", json={"is_active": True}).status_code == 403


def test_bad_or_missing_ids(client):
    assert client.get("/quotation-templates/not-a-uuid").status_code == 422
    assert client.get(f"/quotation-templates/{new_id()}").status_code == 404


# ------------------------------------------------------------------ products list

def test_products_list_for_signed_in_users():
    rows = [{"id": new_id(), "name": "Analytics Suite", "price": 999.0, "is_active": True}]
    calls = []
    app.dependency_overrides[get_product_lister] = lambda: (lambda is_active: calls.append(is_active) or rows)
    app.dependency_overrides[get_current_user] = lambda: STAFF
    try:
        res = TestClient(app).get("/products/?is_active=true")
        assert res.status_code == 200 and res.json()[0]["name"] == "Analytics Suite" and calls == [True]
        del app.dependency_overrides[get_current_user]
        assert TestClient(app).get("/products/").status_code == 401
    finally:
        app.dependency_overrides.clear()

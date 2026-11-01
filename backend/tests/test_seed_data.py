"""Offline tests for database/seed/seed_data.py against an in-memory Supabase fake.
Nothing here talks to a real project."""
import importlib.util
import pathlib
import types
import uuid
from collections import Counter
from datetime import date

import pytest
from faker import Faker

SEED_PATH = pathlib.Path(__file__).resolve().parents[2] / "database" / "seed" / "seed_data.py"
spec = importlib.util.spec_from_file_location("seed_data", SEED_PATH)
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

TODAY = date(2026, 10, 31)


class Transient(Exception):
    pass


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload = db, table, "select", None
        self.filters, self.count, self.window = [], None, None

    # ---- builders
    def select(self, _cols="*", count=None):
        self.op, self.count = "select", count
        return self

    def upsert(self, rows, on_conflict="", ignore_duplicates=False, default_to_null=True):
        assert on_conflict == "id" and ignore_duplicates and default_to_null is False
        self.op, self.payload = "upsert", rows
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self.db.in_sizes.append(len(vals))
        vals = set(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def ilike(self, col, pattern):
        prefix, suffix = pattern.split("%")[0].lower(), pattern.split("%")[-1].lower()
        self.filters.append(lambda r: str(r.get(col, "")).lower().startswith(prefix)
                            and str(r.get(col, "")).lower().endswith(suffix))
        return self

    def limit(self, n):
        self.window = (0, n - 1)
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    # ---- execution
    def execute(self):
        self.db.calls.append((self.table, self.op, len(self.payload or [])))
        rule = self.db.failures.get((self.table, self.op))
        lost_response = False
        if rule and rule["left"] > 0:
            rule["left"] -= 1
            if not rule.get("after_write"):
                raise Transient(f"{self.table} {self.op} unavailable")
            lost_response = True

        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "upsert":
            ids = {r["id"] for r in rows}
            for row in self.payload:
                if row["id"] not in ids:
                    rows.append(dict(row))
                    ids.add(row["id"])
            if lost_response:
                raise Transient("connection reset after write")
            return types.SimpleNamespace(data=[], count=None)
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in matched]
            return types.SimpleNamespace(data=matched, count=None)
        count = len(matched)
        if self.window:
            matched = matched[self.window[0]:self.window[1] + 1]
        return types.SimpleNamespace(data=[dict(r) for r in matched], count=count if self.count else None)


class FakeAuthAdmin:
    def __init__(self, db):
        self.db, self.users = db, []

    def create_user(self, attrs):
        if any(u.email == attrs["email"] for u in self.users):
            raise Exception("A user with this email address has already been registered")
        user = types.SimpleNamespace(id=str(uuid.uuid4()), email=attrs["email"],
                                     app_metadata=attrs.get("app_metadata") or {})
        self.users.append(user)
        if self.db.lose_next_auth_response:
            self.db.lose_next_auth_response = False
            raise Transient("timeout after create")
        return types.SimpleNamespace(user=user)

    def list_users(self, page=1, per_page=50):
        return self.users[(page - 1) * per_page: page * per_page]

    def update_user_by_id(self, uid, attrs):
        user = next(u for u in self.users if u.id == uid)
        user.app_metadata = attrs["app_metadata"]


class FakeSupabase:
    def __init__(self):
        self.tables, self.calls, self.in_sizes, self.failures = {}, [], [], {}
        self.lose_next_auth_response = False
        self.auth = types.SimpleNamespace(admin=FakeAuthAdmin(self))

    def table(self, name):
        return FakeQuery(self, name)

    def fail(self, table, op, times, after_write=False):
        self.failures[(table, op)] = {"left": times, "after_write": after_write}

    def rows(self, table):
        return self.tables.get(table, [])


@pytest.fixture
def db():
    return FakeSupabase()


def make_seeder(db, sleeps=None):
    fake = Faker("en_IN")
    Faker.seed(1)
    return seed.Seeder(db, sleep=(sleeps.append if sleeps is not None else lambda s: None), today=TODAY, fake=fake)


def run_small(db, **kwargs):
    seeder = make_seeder(db)
    seeder.run(small=True, **kwargs)
    return seeder


# ------------------------------------------------------------------ invoice customer fix

def test_every_invoice_and_payment_uses_its_subscriptions_customer(db):
    # 8 customers: an off-by-21 customer (the old bug) cannot line up by accident.
    make_seeder(db).run(num_customers=8, num_subs=60)
    subs = {s["id"]: s for s in db.rows("subscriptions")}
    invoices = db.rows("invoices")
    assert len(invoices) == 60 - 21
    assert all(inv["customer_id"] == subs[inv["subscription_id"]]["customer_id"] for inv in invoices)
    by_invoice = {inv["id"]: inv for inv in invoices}
    assert db.rows("payments")
    assert all(p["customer_id"] == by_invoice[p["invoice_id"]]["customer_id"] for p in db.rows("payments"))
    # The planted demo cases are still there.
    assert Counter(inv["status"] for inv in invoices)["overdue"] == 1
    assert Counter(inv["status"] for inv in invoices)["partial"] == 1


def test_every_subscription_and_invoice_has_lines(db):
    run_small(db)
    sub_lines = Counter(line["subscription_id"] for line in db.rows("subscription_lines"))
    inv_lines = Counter(line["invoice_id"] for line in db.rows("invoice_lines"))
    assert all(sub_lines[s["id"]] == 1 for s in db.rows("subscriptions"))
    assert all(inv_lines[i["id"]] == 1 for i in db.rows("invoices"))


# ------------------------------------------------------------------ retries

def test_retry_uses_five_attempts_with_exponential_backoff():
    sleeps, calls = [], []

    def flaky():
        calls.append(1)
        if len(calls) < 5:
            raise Transient("try again")
        return "ok"

    assert seed.with_retry(flaky, "flaky call", sleep=sleeps.append) == "ok"
    assert sleeps == [0.5, 1, 2, 4]

    calls.clear()
    sleeps.clear()
    with pytest.raises(seed.SeedError, match="after 5 attempts"):
        seed.with_retry(lambda: calls.append(1) or (_ for _ in ()).throw(Transient("down")),
                        "always failing", sleep=sleeps.append)
    assert len(calls) == 5 and sleeps == [0.5, 1, 2, 4]


def test_transient_write_failures_are_retried(db):
    db.fail("invoices", "upsert", 3)
    run_small(db)
    assert db.rows("invoices") and db.rows("payments")


def test_retry_after_lost_response_does_not_duplicate_rows(db):
    db.fail("subscriptions", "upsert", 1, after_write=True)     # written, but the reply was lost
    db.fail("payments", "upsert", 2, after_write=True)
    run_small(db)
    assert len(db.rows("subscriptions")) == 20
    assert len({p["id"] for p in db.rows("payments")}) == len(db.rows("payments"))


def test_auth_user_created_before_a_lost_reply_is_reused(db):
    db.lose_next_auth_response = True
    run_small(db)
    customers = db.rows("customers")
    assert len(customers) == 10
    emails = [u.email for u in db.auth.admin.users]
    assert len(emails) == len(set(emails))


# ------------------------------------------------------------------ batching

def test_rows_are_written_in_batches_of_50(db):
    make_seeder(db).run(num_customers=120, num_subs=130)
    sizes = {table: [n for t, op, n in db.calls if t == table and op == "upsert"]
             for table in ("customers", "subscriptions", "subscription_lines", "invoices")}
    assert sizes["customers"] == [50, 50, 20]
    assert sizes["subscriptions"] == [50, 50, 30]
    assert sizes["subscription_lines"] == [50, 50, 30]
    assert max(sizes["invoices"]) <= 50
    assert all(n <= 50 for _, op, n in db.calls if op == "upsert")


def test_cleanup_sends_id_lists_in_batches_of_50(db):
    make_seeder(db).run(num_customers=120, num_subs=130)
    db.in_sizes.clear()
    make_seeder(db).cleanup_seeded_data()
    assert db.in_sizes and max(db.in_sizes) <= 50
    for table in ("customers", "subscriptions", "subscription_lines", "invoices", "invoice_lines", "payments"):
        assert db.rows(table) == [], table


# ------------------------------------------------------------------ duplicate prevention

def test_refuses_to_seed_on_top_of_an_existing_seed(db):
    run_small(db)
    before = {t: len(rows) for t, rows in db.tables.items()}
    with pytest.raises(seed.SeedError, match="already exist"):
        run_small(db)
    assert {t: len(rows) for t, rows in db.tables.items()} == before


def test_append_reuses_taxes_products_and_plans(db):
    run_small(db)
    catalog = {t: len(db.rows(t)) for t in ("taxes", "products", "variants", "plans")}
    run_small(db, append=True)
    assert {t: len(db.rows(t)) for t in catalog} == catalog
    assert len(db.rows("customers")) == 20


def test_cleanup_then_seed_replaces_the_previous_seed(db):
    run_small(db)
    run_small(db, cleanup=True)
    assert len(db.rows("customers")) == 10
    assert len(db.rows("subscriptions")) == 20


# ------------------------------------------------------------------ partial failures

def test_failed_lines_remove_their_batch_and_stop_the_run(db):
    seeder = make_seeder(db)
    calls = {"n": 0}
    original = db.table

    def table(name):
        q = original(name)
        if name == "subscription_lines":
            real_execute = q.execute

            def execute():
                if q.op == "upsert":
                    calls["n"] += 1
                    if calls["n"] > 1:            # first batch succeeds, second never does
                        raise Transient("lines unavailable")
                return real_execute()
            q.execute = execute
        return q

    db.table = table
    with pytest.raises(seed.SeedError, match="subscription_lines"):
        seeder.run(num_customers=5, num_subs=80)

    subs = db.rows("subscriptions")
    lines = Counter(line["subscription_id"] for line in db.rows("subscription_lines"))
    assert len(subs) == 50                                # the failed second batch was removed
    assert all(lines[s["id"]] == 1 for s in subs)         # no subscription is left without lines
    assert db.rows("invoices") == []                      # the run stopped before invoicing
    assert len(seeder.written["subscriptions"]) == 50


def test_failed_payments_remove_the_batch_invoices_and_lines(db):
    db.fail("payments", "upsert", 5)                      # every retry of the first batch fails
    seeder = make_seeder(db)
    with pytest.raises(seed.SeedError, match="payments"):
        seeder.run(small=True)
    assert db.rows("invoices") == [] and db.rows("invoice_lines") == [] and db.rows("payments") == []
    assert len(db.rows("subscriptions")) == 20            # earlier, complete steps are kept


def test_failure_report_lists_written_ids(db, tmp_path):
    db.fail("invoices", "upsert", 5)
    seeder = make_seeder(db)
    with pytest.raises(seed.SeedError):
        seeder.run(small=True)
    report = seeder.failure_report(tmp_path / "partial.json")
    assert len(report["written"]["subscriptions"]) == 20
    assert report["written"].get("invoices", []) == []
    assert len(report["auth_user_ids"]) == 10
    assert (tmp_path / "partial.json").exists()


def test_importing_the_seed_module_does_not_connect():
    # The module was imported above without SUPABASE_* settings or network access.
    assert callable(seed.get_client) and not hasattr(seed, "supabase")

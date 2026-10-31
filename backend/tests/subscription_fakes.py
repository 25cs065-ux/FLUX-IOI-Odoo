"""In-memory stand-in for SubscriptionRepository used by the subscription tests."""
import copy
import uuid
from datetime import datetime, timezone

from app.repositories.subscription_repository import to_row


def new_id() -> str:
    return str(uuid.uuid4())


class FakeSubscriptionRepository:
    def __init__(self):
        self.customers, self.plans, self.products, self.variants = {}, {}, {}, {}
        self.taxes, self.payment_terms, self.templates = {}, {}, {}
        self.subscriptions, self.lines, self.history = {}, {}, []
        self._seq = 100
        self.fail_line_insert = False
        self.writes = []            # (table, op, keys) for schema contract tests

    def _record(self, table, op, data):
        self.writes.append((table, op, set(data)))

    # ---- seed helpers
    def add(self, table: dict, **row) -> dict:
        row.setdefault("id", new_id())
        row.setdefault("is_active", True)
        table[row["id"]] = row
        return row

    # ---- lookups
    def _get(self, table, key):
        row = table.get(str(key))
        return copy.deepcopy(row) if row else None

    def get_customer(self, customer_id):
        return self._get(self.customers, customer_id)

    def get_customer_by_auth_user(self, auth_user_id):
        return next((dict(c) for c in self.customers.values()
                     if c.get("auth_user_id") == str(auth_user_id)), None)

    def get_plan(self, plan_id):
        return self._get(self.plans, plan_id)

    def get_product(self, product_id):
        return self._get(self.products, product_id)

    def get_variant(self, variant_id):
        return self._get(self.variants, variant_id)

    def get_tax(self, tax_id):
        return self._get(self.taxes, tax_id)

    def get_payment_terms(self, payment_terms_id):
        return self._get(self.payment_terms, payment_terms_id)

    def get_quotation_template(self, template_id):
        return self._get(self.templates, template_id)

    # ---- subscriptions
    def list_subscriptions(self, *, status, customer_id, plan_id, limit, offset):
        rows = [s for s in self.subscriptions.values()
                if (not status or s["status"] == status)
                and (not customer_id or s["customer_id"] == str(customer_id))
                and (not plan_id or s["plan_id"] == str(plan_id))]
        rows.sort(key=lambda s: s["created_at"], reverse=True)
        return copy.deepcopy(rows[offset:offset + limit])

    def get_subscription(self, subscription_id):
        return self._get(self.subscriptions, subscription_id)

    def insert_subscription(self, data):
        self._record("subscriptions", "insert", data)
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "id": new_id(), "subscription_number": f"SUB-{self._seq:06d}", "quotation_number": None,
            "confirmed_at": None, "paused_at": None, "pause_reason": None, "closed_at": None,
            "close_reason": None, "created_at": now, "updated_at": now, **to_row(data),
        }
        self._seq += 1
        self.subscriptions[row["id"]] = row
        return copy.deepcopy(row)

    def update_subscription(self, subscription_id, data, expected_status=None):
        self._record("subscriptions", "update", data)
        row = self.subscriptions.get(str(subscription_id))
        if not row or (expected_status and row["status"] != expected_status):
            return None
        row.update(to_row(data))
        return copy.deepcopy(row)

    def delete_subscription(self, subscription_id):
        sid = str(subscription_id)
        self.subscriptions.pop(sid, None)
        self.lines = {k: v for k, v in self.lines.items() if v["subscription_id"] != sid}
        self.history = [h for h in self.history if h["subscription_id"] != sid]

    # ---- lines / history
    def list_lines(self, subscription_id):
        rows = [l for l in self.lines.values() if l["subscription_id"] == str(subscription_id)]
        return copy.deepcopy(sorted(rows, key=lambda l: l["sequence"]))

    def insert_lines(self, lines):
        if self.fail_line_insert:
            raise RuntimeError("simulated database failure")
        out = []
        for line in lines:
            self._record("subscription_lines", "insert", line)
            row = {"id": new_id(), "created_at": None, "updated_at": None, **to_row(line)}
            self.lines[row["id"]] = row
            out.append(copy.deepcopy(row))
        return out

    def delete_lines(self, subscription_id):
        self.lines = {k: v for k, v in self.lines.items() if v["subscription_id"] != str(subscription_id)}

    def insert_history(self, entry):
        self._record("subscription_status_history", "insert", entry)
        row = {"id": new_id(), "changed_at": datetime.now(timezone.utc).isoformat(),
               "reason": None, **to_row(entry)}
        self.history.append(row)
        return copy.deepcopy(row)

    def list_history(self, subscription_id):
        return copy.deepcopy([h for h in self.history if h["subscription_id"] == str(subscription_id)])


def seed_catalog(r, customer_auth_id, other_customer_auth_id):
    """Customers, plans, products, variants and taxes shared by the API tests."""
    r.customer = r.add(r.customers, name="Acme", auth_user_id=str(customer_auth_id))
    r.other_customer = r.add(r.customers, name="Globex", auth_user_id=str(other_customer_auth_id))
    r.inactive_customer = r.add(r.customers, name="Gone", is_active=False)
    r.plan = r.add(r.plans, name="Pro Monthly", interval="monthly", price=100, min_quantity=1,
                   pausable=True, closable_early=True, renewable=True)
    r.strict_plan = r.add(r.plans, name="Locked Yearly", interval="yearly", price=1000, min_quantity=5,
                          pausable=False, closable_early=False, renewable=False)
    r.product = r.add(r.products, name="Seat", price=50)
    r.variant = r.add(r.variants, product_id=r.product["id"], name="Premium", extra_price=25)
    r.other_product = r.add(r.products, name="Storage", price=10)
    r.gst = r.add(r.taxes, name="GST", rate=18)
    r.net30 = r.add(r.payment_terms, name="Net 30", days_due=30)
    return r

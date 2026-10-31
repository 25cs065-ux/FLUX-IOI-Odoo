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
            row = {"id": new_id(), "created_at": None, "updated_at": None, **to_row(line)}
            self.lines[row["id"]] = row
            out.append(copy.deepcopy(row))
        return out

    def delete_lines(self, subscription_id):
        self.lines = {k: v for k, v in self.lines.items() if v["subscription_id"] != str(subscription_id)}

    def insert_history(self, entry):
        row = {"id": new_id(), "changed_at": datetime.now(timezone.utc).isoformat(),
               "reason": None, **to_row(entry)}
        self.history.append(row)
        return copy.deepcopy(row)

    def list_history(self, subscription_id):
        return copy.deepcopy([h for h in self.history if h["subscription_id"] == str(subscription_id)])

"""Data access for subscriptions. The service layer talks to this interface so
tests can swap in an in-memory fake instead of Supabase."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Protocol
from uuid import UUID

from app.repositories.billing_rpc import BillingRpcMixin, call_supabase


def to_row(data: dict) -> dict:
    """Convert Python values into JSON-safe values for PostgREST."""
    out = {}
    for key, value in data.items():
        if isinstance(value, (Decimal, UUID)):
            value = str(value)
        elif isinstance(value, (date, datetime)):
            value = value.isoformat()
        out[key] = value
    return out


class SubscriptionRepository(Protocol):
    # lookups on tables owned by other modules (read only)
    def get_customer(self, customer_id: UUID) -> Optional[dict]: ...
    def get_customer_by_auth_user(self, auth_user_id: UUID) -> Optional[dict]: ...
    def get_plan(self, plan_id: UUID) -> Optional[dict]: ...
    def get_product(self, product_id: UUID) -> Optional[dict]: ...
    def get_variant(self, variant_id: UUID) -> Optional[dict]: ...
    def get_tax(self, tax_id: UUID) -> Optional[dict]: ...
    def get_payment_terms(self, payment_terms_id: UUID) -> Optional[dict]: ...
    def get_quotation_template(self, template_id: UUID) -> Optional[dict]: ...

    # subscriptions
    def list_subscriptions(self, *, status: Optional[str], customer_id: Optional[UUID],
                           plan_id: Optional[UUID], limit: int, offset: int) -> list[dict]: ...
    def get_subscription(self, subscription_id: UUID) -> Optional[dict]: ...
    def insert_subscription(self, data: dict) -> dict: ...
    def update_subscription(self, subscription_id: UUID, data: dict, expected_status: Optional[str] = None,
                            expected_updated_at: Optional[str] = None) -> Optional[dict]:
        """Returns None if the row is missing or no longer matches the expected values."""
        ...
    def delete_subscription(self, subscription_id: UUID) -> None: ...

    # lines and history
    def list_lines(self, subscription_id: UUID) -> list[dict]: ...
    def insert_lines(self, lines: list[dict]) -> list[dict]: ...
    def delete_lines(self, subscription_id: UUID) -> None: ...
    def delete_lines_by_ids(self, line_ids: list) -> None:
        """One DELETE statement, so it removes all of them or none."""
        ...
    def insert_history(self, entry: dict) -> dict: ...
    def list_history(self, subscription_id: UUID) -> list[dict]: ...

    # Repositories with `transactional = True` also provide the *_tx methods of
    # billing_rpc.BillingRpcMixin; services use them instead of multi-step writes.


class SupabaseSubscriptionRepository(BillingRpcMixin):
    def __init__(self, client):
        self.db = client

    def _call_rpc(self, name, params):
        return call_supabase(self.db, name, params)

    def _one(self, table: str, column: str, value) -> Optional[dict]:
        res = self.db.table(table).select("*").eq(column, str(value)).limit(1).execute()
        return res.data[0] if res.data else None

    def get_customer(self, customer_id):
        return self._one("customers", "id", customer_id)

    def get_customer_by_auth_user(self, auth_user_id):
        return self._one("customers", "auth_user_id", auth_user_id)

    def get_plan(self, plan_id):
        return self._one("plans", "id", plan_id)

    def get_product(self, product_id):
        return self._one("products", "id", product_id)

    def get_variant(self, variant_id):
        return self._one("variants", "id", variant_id)

    def get_tax(self, tax_id):
        return self._one("taxes", "id", tax_id)

    def get_payment_terms(self, payment_terms_id):
        return self._one("payment_terms", "id", payment_terms_id)

    def get_quotation_template(self, template_id):
        return self._one("quotation_templates", "id", template_id)

    def list_subscriptions(self, *, status, customer_id, plan_id, limit, offset):
        query = self.db.table("subscriptions").select("*")
        if status:
            query = query.eq("status", status)
        if customer_id:
            query = query.eq("customer_id", str(customer_id))
        if plan_id:
            query = query.eq("plan_id", str(plan_id))
        res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return res.data or []

    def get_subscription(self, subscription_id):
        return self._one("subscriptions", "id", subscription_id)

    def insert_subscription(self, data):
        return self.db.table("subscriptions").insert(to_row(data)).execute().data[0]

    def update_subscription(self, subscription_id, data, expected_status=None, expected_updated_at=None):
        query = self.db.table("subscriptions").update(to_row(data)).eq("id", str(subscription_id))
        if expected_status:
            # Guards lifecycle changes against concurrent updates.
            query = query.eq("status", expected_status)
        if expected_updated_at:
            # Optimistic lock for edits: fails if anyone saved since we read.
            query = query.eq("updated_at", str(expected_updated_at))
        res = query.execute()
        return res.data[0] if res.data else None

    def delete_subscription(self, subscription_id):
        self.db.table("subscriptions").delete().eq("id", str(subscription_id)).execute()

    def list_lines(self, subscription_id):
        res = (self.db.table("subscription_lines").select("*")
               .eq("subscription_id", str(subscription_id)).order("sequence").execute())
        return res.data or []

    def insert_lines(self, lines):
        if not lines:
            return []
        return self.db.table("subscription_lines").insert([to_row(l) for l in lines]).execute().data

    def delete_lines(self, subscription_id):
        self.db.table("subscription_lines").delete().eq("subscription_id", str(subscription_id)).execute()

    def delete_lines_by_ids(self, line_ids):
        if line_ids:
            self.db.table("subscription_lines").delete().in_("id", [str(i) for i in line_ids]).execute()

    def insert_history(self, entry):
        return self.db.table("subscription_status_history").insert(to_row(entry)).execute().data[0]

    def list_history(self, subscription_id):
        res = (self.db.table("subscription_status_history").select("*")
               .eq("subscription_id", str(subscription_id)).order("changed_at").execute())
        return res.data or []


def get_subscription_repository() -> SubscriptionRepository:
    """FastAPI dependency; tests override it with an in-memory fake."""
    from app.core.database import get_supabase

    return SupabaseSubscriptionRepository(get_supabase())

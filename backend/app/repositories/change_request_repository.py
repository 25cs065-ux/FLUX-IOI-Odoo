"""Data access for change requests. Tests swap in an in-memory fake."""
from typing import Optional, Protocol
from uuid import UUID

from app.repositories.subscription_repository import to_row


class ChangeRequestRepository(Protocol):
    def get_customer(self, customer_id: UUID) -> Optional[dict]: ...
    def get_customer_by_auth_user(self, auth_user_id: UUID) -> Optional[dict]: ...
    def get_subscription(self, subscription_id: UUID) -> Optional[dict]: ...
    def get_request(self, request_id: UUID) -> Optional[dict]: ...
    def list_requests(self, *, customer_id=None, subscription_id=None, status=None,
                      limit: int = 50, offset: int = 0) -> list: ...
    def insert_request(self, data: dict) -> dict: ...
    def update_request(self, request_id: UUID, data: dict) -> Optional[dict]: ...


class SupabaseChangeRequestRepository:
    def __init__(self, client):
        self.db = client

    def _one(self, table: str, column: str, value, columns: str = "*") -> Optional[dict]:
        res = self.db.table(table).select(columns).eq(column, str(value)).limit(1).execute()
        return res.data[0] if res.data else None

    def get_customer(self, customer_id):
        return self._one("customers", "id", customer_id, "id,is_active")

    def get_customer_by_auth_user(self, auth_user_id):
        return self._one("customers", "auth_user_id", auth_user_id, "id,is_active")

    def get_subscription(self, subscription_id):
        return self._one("subscriptions", "id", subscription_id, "id,customer_id")

    def get_request(self, request_id):
        return self._one("change_requests", "id", request_id)

    def list_requests(self, *, customer_id=None, subscription_id=None, status=None, limit=50, offset=0):
        query = self.db.table("change_requests").select("*")
        for column, value in (("customer_id", customer_id), ("subscription_id", subscription_id),
                              ("status", status)):
            if value is not None:
                query = query.eq(column, str(value))
        return query.order("created_at", desc=True).range(offset, offset + limit - 1).execute().data or []

    def insert_request(self, data):
        return self.db.table("change_requests").insert(to_row(data)).execute().data[0]

    def update_request(self, request_id, data):
        res = self.db.table("change_requests").update(to_row(data)).eq("id", str(request_id)).execute()
        return res.data[0] if res.data else None


def get_change_request_repository() -> ChangeRequestRepository:
    """FastAPI dependency; tests override it with an in-memory fake."""
    from app.core.database import get_supabase

    return SupabaseChangeRequestRepository(get_supabase())

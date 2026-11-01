"""Data access for quotation templates. Tests swap in an in-memory fake."""
from typing import Optional, Protocol
from uuid import UUID

from app.repositories.subscription_repository import to_row

TEMPLATE_SELECT = "*, plans(name), quotation_template_lines(*, products(name), variants(name))"


def flatten_template(row: dict) -> dict:
    """Turn PostgREST's embedded plan/product/variant objects into plain name fields."""
    row = dict(row)
    row["plan_name"] = (row.pop("plans", None) or {}).get("name")
    lines = []
    for line in row.pop("quotation_template_lines", None) or []:
        line = dict(line)
        line["product_name"] = (line.pop("products", None) or {}).get("name")
        line["variant_name"] = (line.pop("variants", None) or {}).get("name")
        lines.append(line)
    row["lines"] = lines
    return row


class QuotationTemplateRepository(Protocol):
    def get_plan(self, plan_id: UUID) -> Optional[dict]: ...
    def get_product(self, product_id: UUID) -> Optional[dict]: ...
    def get_variant(self, variant_id: UUID) -> Optional[dict]: ...
    def list_templates(self, *, is_active: Optional[bool] = None) -> list: ...
    def get_template(self, template_id: UUID) -> Optional[dict]: ...
    def insert_template(self, data: dict) -> dict: ...
    def insert_lines(self, rows: list) -> list: ...
    def update_template(self, template_id: UUID, data: dict) -> Optional[dict]: ...
    def delete_template(self, template_id: UUID) -> None: ...


class SupabaseQuotationTemplateRepository:
    def __init__(self, client):
        self.db = client

    def _one(self, table, columns, value):
        res = self.db.table(table).select(columns).eq("id", str(value)).limit(1).execute()
        return res.data[0] if res.data else None

    def get_plan(self, plan_id):
        return self._one("plans", "id,name,is_active", plan_id)

    def get_product(self, product_id):
        return self._one("products", "id,name,is_active", product_id)

    def get_variant(self, variant_id):
        return self._one("variants", "id,product_id,name,is_active", variant_id)

    def list_templates(self, *, is_active=None):
        query = self.db.table("quotation_templates").select(TEMPLATE_SELECT)
        if is_active is not None:
            query = query.eq("is_active", is_active)
        return [flatten_template(r) for r in query.order("created_at", desc=True).execute().data or []]

    def get_template(self, template_id):
        res = (self.db.table("quotation_templates").select(TEMPLATE_SELECT)
               .eq("id", str(template_id)).limit(1).execute())
        return flatten_template(res.data[0]) if res.data else None

    def insert_template(self, data):
        return self.db.table("quotation_templates").insert(to_row(data)).execute().data[0]

    def insert_lines(self, rows):
        return self.db.table("quotation_template_lines").insert([to_row(r) for r in rows]).execute().data or []

    def update_template(self, template_id, data):
        res = self.db.table("quotation_templates").update(to_row(data)).eq("id", str(template_id)).execute()
        return res.data[0] if res.data else None

    def delete_template(self, template_id):
        self.db.table("quotation_template_lines").delete().eq("template_id", str(template_id)).execute()
        self.db.table("quotation_templates").delete().eq("id", str(template_id)).execute()


def get_quotation_template_repository() -> QuotationTemplateRepository:
    """FastAPI dependency; tests override it with an in-memory fake."""
    from app.core.database import get_supabase

    return SupabaseQuotationTemplateRepository(get_supabase())

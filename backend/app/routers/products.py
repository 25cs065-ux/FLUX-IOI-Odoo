"""Products API (read only).

Lists products so forms can offer them by name, e.g. quotation template lines.
RBAC: any signed-in user.
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.current_user import CurrentUser, Role, require_roles

router = APIRouter(prefix="/products", tags=["products"])

any_role = require_roles(Role.ADMIN, Role.STAFF, Role.CUSTOMER)


class ProductResponse(BaseModel):
    id: UUID
    name: str
    price: float
    is_active: bool = True


def list_product_rows(is_active: Optional[bool]) -> list:
    from app.core.database import get_supabase

    query = get_supabase().table("products").select("id,name,price,is_active")
    if is_active is not None:
        query = query.eq("is_active", is_active)
    return query.order("name").execute().data or []


def get_product_lister():
    """FastAPI dependency; tests override it."""
    return list_product_rows


@router.get("/", response_model=List[ProductResponse])
def list_products(
    is_active: Optional[bool] = Query(None),
    user: CurrentUser = Depends(any_role),
    lister=Depends(get_product_lister),
):
    return lister(is_active)

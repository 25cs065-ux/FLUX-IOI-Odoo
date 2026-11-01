import threading
import time
from collections import OrderedDict

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.supabase import supabase
from typing import Dict, Any

security = HTTPBearer()

# A page load sends many API calls with the same token. Remember each resolved
# user for a short time so they do not all repeat the Supabase Auth round trip
# and the customers lookup. Failures are never cached; role changes apply
# within USER_CACHE_SECONDS.
USER_CACHE_SECONDS = 30
_USER_CACHE_MAX = 1024
_user_cache: "OrderedDict[str, tuple[float, Dict[str, Any]]]" = OrderedDict()
_user_cache_lock = threading.Lock()


def clear_user_cache() -> None:
    with _user_cache_lock:
        _user_cache.clear()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    token = credentials.credentials
    with _user_cache_lock:
        entry = _user_cache.get(token)
        if entry and entry[0] > time.time():
            return dict(entry[1])
        _user_cache.pop(token, None)

    user = _resolve_user(token)
    with _user_cache_lock:
        _user_cache[token] = (time.time() + USER_CACHE_SECONDS, user)
        while len(_user_cache) > _USER_CACHE_MAX:
            _user_cache.popitem(last=False)
    return dict(user)


def _resolve_user(token: str) -> Dict[str, Any]:
    try:
        user_res = supabase.auth.get_user(token)
        if not user_res or not user_res.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )
        user = user_res.user
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}"
        )

    role = "customer"
    user_id = user.id
    email = user.email

    try:
        # 1. Primary trusted lookup by auth_user_id in customers table
        cust_res = supabase.table("customers").select("*").eq("auth_user_id", user_id).execute()
        if cust_res.data and len(cust_res.data) > 0:
            cust_record = cust_res.data[0]
            role = cust_record.get("role", "customer")
        else:
            # 2. Trusted app_metadata ONLY (never user_metadata) for elevated privileges
            app_metadata = getattr(user, "app_metadata", {}) or {}
            meta_role = app_metadata.get("role")
            
            if meta_role in ("admin", "staff"):
                role = meta_role
            else:
                # 3. Conditional Email Fallback: only if confirmed and auth_user_id is strictly null
                is_confirmed = bool(
                    getattr(user, "email_confirmed_at", None) or 
                    getattr(user, "confirmed_at", None)
                )
                if is_confirmed and email:
                    match_res = (
                        supabase.table("customers")
                        .select("*")
                        .eq("email", email)
                        .is_("auth_user_id", "null")
                        .execute()
                    )
                    if match_res.data and len(match_res.data) > 0:
                        matched = match_res.data[0]
                        update_res = (
                            supabase.table("customers")
                            .update({"auth_user_id": user_id})
                            .eq("id", matched["id"])
                            .is_("auth_user_id", "null")
                            .execute()
                        )
                        if update_res.data and len(update_res.data) > 0:
                            role = matched.get("role", "customer")
    except Exception:
        # Fallback strictly checks trusted app_metadata ONLY (never user_metadata)
        app_metadata = getattr(user, "app_metadata", {}) or {}
        role = app_metadata.get("role", "customer")

    return {
        "id": user_id,
        "email": email,
        "role": role,
    }

def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user

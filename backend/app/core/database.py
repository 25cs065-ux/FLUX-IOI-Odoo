"""Lazily created Supabase service-role client (server side only)."""
import os
from functools import lru_cache

from dotenv import load_dotenv


@lru_cache
def get_supabase():
    from supabase import create_client

    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    # .env.example names it SUPABASE_SERVICE_ROLE_KEY; accept the older name too.
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, key)

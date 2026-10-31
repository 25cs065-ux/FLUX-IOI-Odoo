"""Lazily created Supabase service-role client (server side only)."""
import os
from functools import lru_cache

from dotenv import load_dotenv


@lru_cache
def get_supabase():
    import httpx
    from supabase import create_client
    from supabase.lib.client_options import SyncClientOptions

    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    # .env.example names it SUPABASE_SERVICE_ROLE_KEY; accept the older name too.
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    # Shared by worker threads: HTTP/2's single multiplexed connection fails
    # under concurrent use, an HTTP/1.1 pool does not (see app/core/supabase.py).
    return create_client(url, key, options=SyncClientOptions(httpx_client=httpx.Client(http2=False, timeout=30)))

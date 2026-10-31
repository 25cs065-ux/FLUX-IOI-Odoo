from supabase import create_client, Client
from app.core.config import settings
from typing import Optional

_supabase_client: Optional[Client] = None

def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    url = settings.SUPABASE_URL or "https://placeholder-domain.supabase.co"
    key = settings.SUPABASE_SERVICE_KEY or "placeholder-key"
    _supabase_client = create_client(url, key)
    return _supabase_client

class LazySupabaseProxy:
    def __getattr__(self, name):
        client = get_supabase()
        return getattr(client, name)

supabase: Client = LazySupabaseProxy()

import httpx
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions
from app.core.config import settings

# FastAPI runs sync endpoints in worker threads that all share this client.
# The default HTTP/2 transport multiplexes them over one connection, which
# fails under concurrent use (httpx ReadError / RemoteProtocolError -> HTTP 500).
# An HTTP/1.1 connection pool is thread-safe.
supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_KEY,
    options=SyncClientOptions(httpx_client=httpx.Client(http2=False, timeout=30)),
)

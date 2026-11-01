"""Shared test setup.

app.core.config validates Supabase settings when it is imported, so test
modules that import app.core.auth / app.core.supabase fail to load without
them. Provide obviously fake, non-secret values when none are set so the full
suite runs in CI and on fresh checkouts. Tests mock every Supabase call; these
values must never point at a real project.
"""
import os

os.environ.setdefault("SUPABASE_URL", "https://unit-test-project.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-role-key")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_auth_cache():
    """Verified users are cached per token; keep tests independent."""
    from app.core.auth import clear_user_cache
    from app.core.current_user import clear_auth_cache

    clear_auth_cache()
    clear_user_cache()
    yield
    clear_auth_cache()
    clear_user_cache()

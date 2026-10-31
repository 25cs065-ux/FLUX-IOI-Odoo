"""Supabase Auth access-token verification, done locally in FastAPI.

Checks, in order:
  * signature   - HS256 with SUPABASE_JWT_SECRET (legacy projects), or
                  ES256/RS256 with the project's JWKS (asymmetric signing keys).
                  The key type always follows the algorithm, so an HS256 token
                  can never be checked against a public key ("alg confusion"),
                  and "none" is rejected.
  * expiry      - exp is required and enforced (nbf/iat too when present)
  * audience    - aud must equal SUPABASE_JWT_AUDIENCE (default "authenticated")
  * issuer      - iss must equal <SUPABASE_URL>/auth/v1
  * user        - sub must be a UUID, and the role claim must be "authenticated"
                  (rejects the project's anon / service_role keys)

Environment (names only; never logged):
  SUPABASE_URL           required
  SUPABASE_JWT_SECRET    required only if the project still signs with HS256
  SUPABASE_JWT_AUDIENCE  optional, default "authenticated"
"""
import os
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import jwt

ASYMMETRIC_ALGORITHMS = ("ES256", "RS256")
CLOCK_SKEW_SECONDS = 10


class InvalidToken(Exception):
    """The token is not acceptable (client error -> 401)."""


class AuthUnavailable(Exception):
    """The server cannot verify tokens right now (server error -> 503)."""


@dataclass(frozen=True)
class AuthSettings:
    supabase_url: str
    jwt_secret: Optional[str] = None
    audience: str = "authenticated"

    @property
    def issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.issuer}/.well-known/jwks.json"


def load_auth_settings() -> Optional[AuthSettings]:
    from dotenv import load_dotenv

    load_dotenv()
    url = (os.getenv("SUPABASE_URL") or "").strip()
    if not url:
        return None
    return AuthSettings(
        supabase_url=url,
        jwt_secret=(os.getenv("SUPABASE_JWT_SECRET") or "").strip() or None,
        audience=(os.getenv("SUPABASE_JWT_AUDIENCE") or "authenticated").strip(),
    )


class SupabaseTokenVerifier:
    def __init__(self, settings: AuthSettings, jwk_client=None):
        self.settings = settings
        self._jwk_client = jwk_client

    @property
    def jwk_client(self):
        if self._jwk_client is None:
            # Caches keys; refetches when an unknown kid appears (key rotation).
            self._jwk_client = jwt.PyJWKClient(self.settings.jwks_url, cache_keys=True, lifespan=600)
        return self._jwk_client

    def verify(self, token: str) -> dict:
        """Returns the verified claims or raises InvalidToken / AuthUnavailable."""
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise InvalidToken("Malformed token") from exc
        algorithm = header.get("alg")

        if algorithm == "HS256":
            if not self.settings.jwt_secret:
                # Without the secret we can only tell a forgery from a server
                # misconfiguration by asking which keys the project publishes:
                # none means the project signs with HS256 and we lack the secret.
                if not self._project_publishes_signing_keys():
                    raise AuthUnavailable("SUPABASE_JWT_SECRET is required for this project's HS256 tokens")
                raise InvalidToken("HS256 tokens are not accepted by this server")
            key = self.settings.jwt_secret
        elif algorithm in ASYMMETRIC_ALGORITHMS:
            key = self._public_key(token)
        else:
            raise InvalidToken("Unsupported token algorithm")

        try:
            claims = jwt.decode(
                token, key, algorithms=[algorithm],
                audience=self.settings.audience, issuer=self.settings.issuer,
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise InvalidToken("Token has expired") from exc
        except jwt.PyJWTError as exc:
            raise InvalidToken("Invalid token") from exc

        if claims.get("role") != "authenticated":
            raise InvalidToken("Token is not a signed-in user token")
        try:
            UUID(str(claims["sub"]))
        except ValueError as exc:
            raise InvalidToken("Invalid token subject") from exc
        return claims

    def _project_publishes_signing_keys(self) -> bool:
        try:
            return bool(self.jwk_client.get_signing_keys())
        except jwt.PyJWKClientConnectionError as exc:
            raise AuthUnavailable("Cannot fetch Supabase signing keys") from exc
        except (jwt.PyJWKClientError, jwt.PyJWKSetError):
            return False                 # empty key set / no signing keys

    def _public_key(self, token: str):
        try:
            signing_key = self.jwk_client.get_signing_key_from_jwt(token)
        except jwt.PyJWKClientConnectionError as exc:
            raise AuthUnavailable("Cannot fetch Supabase signing keys") from exc
        except (jwt.PyJWKClientError, jwt.PyJWTError) as exc:
            raise InvalidToken("Unknown signing key") from exc
        return signing_key.key

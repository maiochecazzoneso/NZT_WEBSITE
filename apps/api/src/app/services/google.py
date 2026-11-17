"""Google OIDC Authorization Code + PKCE S256 client (spec §5, D-A11).

Egress goes only to the configured Google endpoints (authorization/token/JWKS).
The ID token is verified locally: RS256 signature against the cached Google JWKS,
iss in the allowed issuers, aud == client_id, exp/iat, nonce, email_verified is true."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWK

from app.config import Settings
from app.schemas import InvalidEmailError, canonical_email
from app.security.jose_utils import b64url_encode

logger = logging.getLogger(__name__)

OAUTH_STATE_TTL_SECONDS = 300
_JWKS_TTL_SECONDS = 3600
_JWKS_MIN_REFRESH_SECONDS = 60


class OIDCError(Exception):
    """Login with Google failed. ``status`` 400 (client/IdP rejected) or 502 (IdP down)."""

    def __init__(self, description: str, status: int = 400) -> None:
        super().__init__(description)
        self.description = description
        self.status = status


@dataclass(frozen=True, slots=True)
class AuthorizationRequest:
    url: str
    state: str
    code_verifier: str
    nonce: str


@dataclass(frozen=True, slots=True)
class GoogleIdentity:
    sub: str
    email: str


def pkce_challenge(verifier: str) -> str:
    return b64url_encode(hashlib.sha256(verifier.encode("ascii")).digest())


class GoogleOIDCClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._s = settings
        self._http = http
        self._jwks: dict[str, PyJWK] = {}
        self._jwks_fetched_at = 0.0
        self._jwks_lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._s.google_client_id and self._s.google_client_secret)

    def build_authorization_request(self) -> AuthorizationRequest:
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)  # 86 chars, within RFC 7636's 43..128
        nonce = secrets.token_urlsafe(32)
        params = {
            "response_type": "code",
            "client_id": self._s.google_client_id or "",
            "redirect_uri": self._s.effective_google_redirect_uri,
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": pkce_challenge(verifier),
            "code_challenge_method": "S256",
        }
        url = f"{self._s.google_authorization_endpoint}?{urlencode(params)}"
        return AuthorizationRequest(url=url, state=state, code_verifier=verifier, nonce=nonce)

    async def exchange_code(self, *, code: str, code_verifier: str, nonce: str) -> GoogleIdentity:
        assert self._s.google_client_secret is not None
        try:
            resp = await self._http.post(
                self._s.google_token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self._s.effective_google_redirect_uri,
                    "client_id": self._s.google_client_id or "",
                    "client_secret": self._s.google_client_secret.get_secret_value(),
                    "code_verifier": code_verifier,
                },
                headers={"Accept": "application/json"},
                timeout=self._s.google_http_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            logger.warning("google token endpoint unreachable: %s", type(exc).__name__)
            raise OIDCError("Identity provider unavailable", status=502) from exc
        if resp.status_code != 200:
            logger.info("google token exchange rejected: HTTP %s", resp.status_code)
            raise OIDCError("Authorization code exchange failed")
        try:
            body = resp.json()
        except ValueError as exc:
            raise OIDCError("Invalid identity provider response", status=502) from exc
        id_token = body.get("id_token") if isinstance(body, dict) else None
        if not isinstance(id_token, str):
            raise OIDCError("Identity provider returned no id_token")
        claims = await self._verify_id_token(id_token)

        token_nonce = claims.get("nonce")
        if not isinstance(token_nonce, str) or not hmac.compare_digest(token_nonce, nonce):
            raise OIDCError("Invalid id_token nonce")
        if claims.get("email_verified") is not True:
            raise OIDCError("Google account email is not verified")
        email, sub = claims.get("email"), claims.get("sub")
        if not isinstance(email, str) or not email:
            raise OIDCError("id_token has no usable email")
        if not isinstance(sub, str) or not sub or len(sub) > 255:
            raise OIDCError("id_token has no usable sub")
        try:
            # Same canonical form as local accounts (review I5): lookup/linking keys match.
            canonical = canonical_email(email)
        except InvalidEmailError as exc:
            raise OIDCError("id_token has no usable email") from exc
        return GoogleIdentity(sub=sub, email=canonical)

    async def _verify_id_token(self, id_token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise OIDCError("Malformed id_token") from exc
        if header.get("alg") != "RS256":
            raise OIDCError("Unexpected id_token algorithm")
        kid = header.get("kid")
        if not isinstance(kid, str):
            raise OIDCError("id_token has no kid")
        key = await self._get_key(kid)
        try:
            claims: dict[str, Any] = jwt.decode(
                id_token,
                key=key,
                algorithms=["RS256"],
                audience=self._s.google_client_id,
                issuer=self._s.google_issuers,
                leeway=30,
                options={"require": ["iss", "aud", "exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise OIDCError("Invalid id_token") from exc
        return claims

    async def _get_key(self, kid: str) -> PyJWK:
        now = time.monotonic()
        fresh = now - self._jwks_fetched_at < _JWKS_TTL_SECONDS
        if kid in self._jwks and fresh:
            return self._jwks[kid]
        async with self._jwks_lock:
            now = time.monotonic()
            stale = now - self._jwks_fetched_at >= _JWKS_TTL_SECONDS
            may_refresh = now - self._jwks_fetched_at >= _JWKS_MIN_REFRESH_SECONDS
            if stale or (kid not in self._jwks and may_refresh):
                await self._refresh_jwks()
        if kid not in self._jwks:
            raise OIDCError("Unknown id_token signing key")
        return self._jwks[kid]

    async def _refresh_jwks(self) -> None:
        try:
            resp = await self._http.get(
                self._s.google_jwks_uri, timeout=self._s.google_http_timeout_seconds
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OIDCError("Identity provider keys unavailable", status=502) from exc
        keys: dict[str, PyJWK] = {}
        for item in data.get("keys", []) if isinstance(data, dict) else []:
            if not isinstance(item, dict) or item.get("kty") != "RSA":
                continue
            if "d" in item or not isinstance(item.get("kid"), str):
                continue
            try:
                keys[item["kid"]] = PyJWK(item, algorithm="RS256")
            except jwt.PyJWTError:
                continue
        self._jwks = keys
        self._jwks_fetched_at = time.monotonic()

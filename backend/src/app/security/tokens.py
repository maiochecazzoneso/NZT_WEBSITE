"""Access tokens (spec §6.1, D-A4/D-A6): EdDSA/Ed25519 JWT, claims exactly
sub, iss, exp, jti, cnf{jkt} (+ iat, + iat_ms). Header: alg=EdDSA, typ=at+jwt, kid=RFC 7638
thumbprint of the public key. Refresh tokens: 32 random bytes, stored as SHA-256 hex.

``iat_ms`` (addition, review L3) is the issuance instant in milliseconds read from the
SHARED Redis clock; it is used only to order the token against revocation markers, which
are written with the same clock (see services/sessions.py). ``iat``/``exp`` stay integer
seconds from the local clock (RFC 7519 NumericDate, validated by PyJWT)."""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.config import Settings
from app.security.jose_utils import b64url_encode, jwk_thumbprint

logger = logging.getLogger(__name__)

ACCESS_TOKEN_ALG = "EdDSA"  # noqa: S105 - algorithm name, not a secret
ACCESS_TOKEN_TYP = "at+jwt"  # noqa: S105 - RFC 9068 media type
_MAX_TOKEN_LEN = 4096


class AccessTokenError(Exception):
    def __init__(self, description: str) -> None:
        super().__init__(description)
        self.description = description


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    sub: uuid.UUID
    jti: str
    iat: int
    exp: int
    jkt: str
    iat_ms: int  # revocation-ordering instant (shared Redis clock), see module docstring


def _strict_int(value: object, name: str) -> int:
    """JSON integer only: never bool/float/str (review L2 audit)."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AccessTokenError(f"invalid {name}")
    return value


def load_signing_key(settings: Settings) -> Ed25519PrivateKey:
    pem = settings.access_token_private_key_pem
    if pem is None:
        if settings.is_production:  # also enforced by Settings validation
            raise RuntimeError("NZT_ACCESS_TOKEN_PRIVATE_KEY_PEM is required in production")
        logger.warning("No access-token key configured: using an EPHEMERAL Ed25519 key")
        return Ed25519PrivateKey.generate()
    key = serialization.load_pem_private_key(pem.get_secret_value().encode(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("NZT_ACCESS_TOKEN_PRIVATE_KEY_PEM must be an Ed25519 private key")
    return key


class AccessTokenService:
    def __init__(self, key: Ed25519PrivateKey, *, issuer: str, ttl_seconds: int) -> None:
        self._key = key
        self._public = key.public_key()
        raw = self._public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.kid = jwk_thumbprint({"kty": "OKP", "crv": "Ed25519", "x": b64url_encode(raw)})
        self.issuer = issuer
        self.ttl = ttl_seconds

    def issue(
        self,
        *,
        user_id: uuid.UUID,
        jkt: str,
        now: int | None = None,
        issued_ms: int | None = None,
    ) -> str:
        iat = int(time.time()) if now is None else now
        payload: dict[str, Any] = {
            "sub": str(user_id),
            "iss": self.issuer,
            "iat": iat,
            "exp": iat + self.ttl,
            "jti": str(uuid.uuid4()),
            "cnf": {"jkt": jkt},
            "iat_ms": time.time_ns() // 1_000_000 if issued_ms is None else issued_ms,
        }
        return jwt.encode(
            payload,
            self._key,
            algorithm=ACCESS_TOKEN_ALG,
            headers={"kid": self.kid, "typ": ACCESS_TOKEN_TYP},
        )

    def verify(self, token: str) -> AccessTokenClaims:
        if len(token) > _MAX_TOKEN_LEN:
            raise AccessTokenError("token too large")
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != ACCESS_TOKEN_ALG or header.get("kid") != self.kid:
                raise AccessTokenError("unexpected token header")
            if header.get("typ") != ACCESS_TOKEN_TYP:
                raise AccessTokenError("unexpected token type")
            claims = jwt.decode(
                token,
                self._public,
                algorithms=[ACCESS_TOKEN_ALG],
                issuer=self.issuer,
                options={
                    "require": ["sub", "iss", "exp", "iat", "jti"],
                    "verify_aud": False,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            raise AccessTokenError("token expired") from exc
        except jwt.PyJWTError as exc:
            raise AccessTokenError("invalid token") from exc
        cnf = claims.get("cnf")
        if not isinstance(cnf, dict) or not isinstance(cnf.get("jkt"), str):
            raise AccessTokenError("token is not DPoP-bound (missing cnf.jkt)")
        sub_raw, jti = claims["sub"], claims["jti"]
        if not isinstance(sub_raw, str) or not isinstance(jti, str):
            raise AccessTokenError("invalid sub/jti")
        try:
            sub = uuid.UUID(sub_raw)
        except ValueError as exc:
            raise AccessTokenError("invalid sub") from exc
        iat = _strict_int(claims["iat"], "iat")
        exp = _strict_int(claims["exp"], "exp")
        raw_ms = claims.get("iat_ms")
        # Tokens minted before iat_ms existed: assume the LAST ms of their iat second, i.e.
        # exactly the old (conservative) second-granularity semantics.
        iat_ms = iat * 1000 + 999 if raw_ms is None else _strict_int(raw_ms, "iat_ms")
        return AccessTokenClaims(sub=sub, jti=jti, iat=iat, exp=exp, jkt=cnf["jkt"], iat_ms=iat_ms)


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)  # 32 bytes of CSPRNG entropy


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("ascii", errors="strict")).hexdigest()

"""DPoP proof validation - RFC 9449 (D-A5).

Strict profile:
* JOSE header: typ == "dpop+jwt", alg == "ES256" (only), jwk = EC P-256 PUBLIC key.
  Any private member, other kty/crv, alg none/HS*/RS* -> invalid.
* Claims: jti (<=256 chars), htm == request method, htu == configured public base URL +
  request path (scheme/host/port/path compared, query/fragment ignored),
  |now - iat| <= leeway, ath == b64url(SHA-256(access token)) when an access token is
  presented (resource requests only).
* Claim types are checked strictly BEFORE any arithmetic (review L2): iat must be a JSON
  number that is not a boolean, finite (no NaN/Infinity, which Python's json accepts) and
  within a sane NumericDate range; anything else is an invalid proof (401), never a 500.
* jti replay protection: Redis SET NX with TTL >= 2*leeway (fail-closed).
"""

from __future__ import annotations

import hashlib
import hmac
import math
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from redis.asyncio import Redis

from app.security.jose_utils import b64url_decode, jwk_thumbprint, sha256_b64url

DPOP_TYP = "dpop+jwt"
DPOP_ALG = "ES256"
_PRIVATE_JWK_MEMBERS = frozenset({"d", "p", "q", "dp", "dq", "qi", "oth", "k"})
_MAX_PROOF_LEN = 4096
_MAX_JTI_LEN = 256
_P256_COORD_B64_LEN = 43
# NumericDate sanity range for iat: [1970, 2^31) seconds. Rejects absurd values (incl.
# huge integers whose float() conversion would raise OverflowError) before any math.
_MAX_NUMERIC_DATE = 2**31


class DPoPError(Exception):
    """Invalid DPoP proof. ``description`` is safe to return to the client."""

    def __init__(self, description: str) -> None:
        super().__init__(description)
        self.description = description


@dataclass(frozen=True, slots=True)
class DPoPProof:
    jkt: str
    jti: str
    iat: int
    jwk: dict[str, str]


def _numeric_date(value: object) -> float:
    """Strict NumericDate: int/float, never bool, finite, within the sane range."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise DPoPError("invalid iat")
    if isinstance(value, float) and not math.isfinite(value):
        raise DPoPError("invalid iat")
    if not 0 <= value < _MAX_NUMERIC_DATE:
        raise DPoPError("invalid iat")
    return float(value)


def _normalize_url(url: str) -> tuple[str, str, int, str]:
    try:
        parts = urlsplit(url)
    except ValueError as exc:  # e.g. unbalanced IPv6 brackets
        raise DPoPError("htu is not an absolute http(s) URI") from exc
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"} or not parts.hostname:
        raise DPoPError("htu is not an absolute http(s) URI")
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError as exc:
        raise DPoPError("htu has an invalid port") from exc
    return scheme, parts.hostname.lower(), port, parts.path or "/"


def _public_key_from_jwk(jwk: object) -> tuple[ec.EllipticCurvePublicKey, dict[str, str]]:
    if not isinstance(jwk, dict):
        raise DPoPError("jwk header must be a JSON object")
    if _PRIVATE_JWK_MEMBERS & jwk.keys():
        raise DPoPError("jwk must not contain private key material")
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise DPoPError("jwk must be an EC P-256 public key")
    x, y = jwk.get("x"), jwk.get("y")
    if not isinstance(x, str) or not isinstance(y, str):
        raise DPoPError("jwk x/y missing")
    # P-256 coordinates are exactly 32 bytes = exactly 43 canonical base64url chars.
    if len(x) != _P256_COORD_B64_LEN or len(y) != _P256_COORD_B64_LEN:
        raise DPoPError("jwk x/y must be 32 bytes")
    try:
        xb, yb = b64url_decode(x), b64url_decode(y)
    except ValueError as exc:
        raise DPoPError("jwk x/y not base64url") from exc
    if len(xb) != 32 or len(yb) != 32:
        raise DPoPError("jwk x/y must be 32 bytes")
    try:
        key = ec.EllipticCurvePublicNumbers(
            int.from_bytes(xb, "big"), int.from_bytes(yb, "big"), ec.SECP256R1()
        ).public_key()
    except ValueError as exc:  # point not on curve
        raise DPoPError("jwk is not a valid P-256 point") from exc
    return key, {"kty": "EC", "crv": "P-256", "x": x, "y": y}


class DPoPValidator:
    def __init__(self, *, redis: Redis, public_base_url: str, iat_leeway: int) -> None:
        self._redis = redis
        self._base = public_base_url.rstrip("/")
        self._leeway = iat_leeway

    def expected_htu(self, path: str) -> str:
        return f"{self._base}{path}"

    async def validate(
        self,
        proof: str | None,
        *,
        method: str,
        path: str,
        access_token: str | None = None,
        now: float | None = None,
    ) -> DPoPProof:
        if not proof:
            raise DPoPError("missing DPoP proof")
        if len(proof) > _MAX_PROOF_LEN or proof.count(".") != 2:
            raise DPoPError("malformed DPoP proof")
        try:
            header = jwt.get_unverified_header(proof)
        except jwt.PyJWTError as exc:
            raise DPoPError("malformed DPoP proof") from exc
        if header.get("typ") != DPOP_TYP:
            raise DPoPError("typ must be dpop+jwt")
        if header.get("alg") != DPOP_ALG:
            raise DPoPError("unsupported DPoP alg (only ES256)")
        key, public_jwk = _public_key_from_jwk(header.get("jwk"))

        try:
            claims: dict[str, Any] = jwt.decode(
                proof,
                key=key,
                algorithms=[DPOP_ALG],
                options={
                    "verify_signature": True,
                    "verify_exp": False,
                    "verify_nbf": False,
                    "verify_iat": False,
                    "verify_aud": False,
                    "verify_iss": False,
                    "require": ["jti", "htm", "htu", "iat"],
                },
            )
        except jwt.PyJWTError as exc:
            raise DPoPError("invalid DPoP proof signature or claims") from exc

        jti, htm, htu, iat = claims["jti"], claims["htm"], claims["htu"], claims["iat"]
        if not isinstance(jti, str) or not 8 <= len(jti) <= _MAX_JTI_LEN:
            raise DPoPError("invalid jti")
        if not isinstance(htm, str) or htm != method.upper():
            raise DPoPError("htm mismatch")
        if not isinstance(htu, str) or _normalize_url(htu) != _normalize_url(
            self.expected_htu(path)
        ):
            raise DPoPError("htu mismatch")
        iat_value = _numeric_date(iat)
        current = time.time() if now is None else now
        if not abs(current - iat_value) <= self._leeway:  # NaN-safe formulation
            raise DPoPError("proof iat outside acceptable window")

        if access_token is not None:
            ath = claims.get("ath")
            if not isinstance(ath, str):
                raise DPoPError("missing ath")
            if not hmac.compare_digest(ath, sha256_b64url(access_token)):
                raise DPoPError("ath mismatch")

        jkt = jwk_thumbprint(public_jwk)
        # Replay protection (global jti namespace, scoped by key to avoid cross-client DoS).
        replay_key = "dpop:jti:" + hashlib.sha256(f"{jkt}:{jti}".encode()).hexdigest()
        stored = await self._redis.set(replay_key, "1", nx=True, ex=self._leeway * 2 + 5)
        if not stored:
            raise DPoPError("DPoP proof replayed")
        return DPoPProof(jkt=jkt, jti=jti, iat=int(iat_value), jwk=public_jwk)

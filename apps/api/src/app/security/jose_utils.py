"""Small strict JOSE helpers (base64url, RFC 7638 thumbprints)."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from collections.abc import Mapping

# Unpadded base64url alphabet only (RFC 4648 §5, RFC 7515 §2). ASCII-only on purpose.
_B64URL = re.compile(r"[A-Za-z0-9_-]*", re.ASCII)


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(data: str) -> bytes:
    """STRICT canonical base64url (review I3): alphabet [A-Za-z0-9_-] only, no padding, no
    whitespace, no impossible length, and the unused trailing bits must be zero (checked by
    re-encoding). Every byte string therefore has exactly ONE accepted encoding, so a JWK
    cannot be spelled several ways to obtain several RFC 7638 thumbprints."""
    if not isinstance(data, str) or _B64URL.fullmatch(data) is None or len(data) % 4 == 1:
        raise ValueError("invalid base64url")
    try:
        raw = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64url") from exc
    if b64url_encode(raw) != data:
        raise ValueError("non-canonical base64url")
    return raw


def sha256_b64url(data: str | bytes) -> str:
    raw = data.encode("ascii") if isinstance(data, str) else data
    return b64url_encode(hashlib.sha256(raw).digest())


def jwk_thumbprint(jwk: Mapping[str, str]) -> str:
    """RFC 7638 SHA-256 thumbprint over the REQUIRED members only, lexicographic order,
    no whitespace."""
    kty = jwk["kty"]
    if kty == "EC":
        members = {"crv": jwk["crv"], "kty": kty, "x": jwk["x"], "y": jwk["y"]}
    elif kty == "OKP":
        members = {"crv": jwk["crv"], "kty": kty, "x": jwk["x"]}
    else:
        raise ValueError("unsupported kty for thumbprint")
    canonical = json.dumps(members, separators=(",", ":"), sort_keys=True)
    return sha256_b64url(canonical.encode("utf-8"))

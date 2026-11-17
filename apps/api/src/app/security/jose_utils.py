"""Small strict JOSE helpers (base64url, RFC 7638 thumbprints)."""

from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Mapping


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(data: str) -> bytes:
    if not isinstance(data, str) or any(c in data for c in "=+/ \n\r\t"):
        raise ValueError("invalid base64url")
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


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

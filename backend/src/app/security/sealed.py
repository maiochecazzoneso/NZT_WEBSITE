"""AEAD sealing (AES-256-GCM) for the transient OAuth state cookie (D-A11)."""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import Settings
from app.security.jose_utils import b64url_decode, b64url_encode

logger = logging.getLogger(__name__)

_AAD = b"nzt-oauth-state-v1"
_MAX_COOKIE_LEN = 2048


class SealError(Exception):
    pass


class Sealer:
    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("AES-256-GCM key must be 32 bytes")
        self._aead = AESGCM(key)

    @classmethod
    def from_settings(cls, settings: Settings) -> Sealer:
        if settings.oauth_state_key is None:
            if settings.is_production:
                raise RuntimeError("NZT_OAUTH_STATE_KEY is required in production")
            logger.warning("No OAuth state key configured: using an EPHEMERAL key")
            return cls(AESGCM.generate_key(bit_length=256))
        raw = base64.urlsafe_b64decode(settings.oauth_state_key.get_secret_value() + "==")
        return cls(raw)

    def seal(self, payload: dict[str, Any]) -> str:
        nonce = os.urandom(12)
        data = json.dumps(payload, separators=(",", ":")).encode()
        return b64url_encode(nonce + self._aead.encrypt(nonce, data, _AAD))

    def unseal(self, token: str) -> dict[str, Any]:
        if not token or len(token) > _MAX_COOKIE_LEN:
            raise SealError("invalid sealed value")
        try:
            blob = b64url_decode(token)
            if len(blob) < 12 + 16:
                raise SealError("invalid sealed value")
            data = self._aead.decrypt(blob[:12], blob[12:], _AAD)
            payload = json.loads(data)
        except (ValueError, InvalidTag) as exc:
            raise SealError("invalid sealed value") from exc
        if not isinstance(payload, dict):
            raise SealError("invalid sealed value")
        return payload

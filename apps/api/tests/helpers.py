"""Test helpers: DPoP client keys/proofs and a local fake Google IdP (OIDC + PKCE)."""

from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs

import jwt
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

API_BASE = "https://api.nztsolutions.it"
PORTAL_ORIGIN = "https://clienti.nztsolutions.it"
GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "test-google-client-secret"
FAKE_IDP = "https://fake-idp.test"
FAKE_ISSUER = "https://accounts.google.com"
STRONG_PASSWORD = "SuperSecurePassword123!"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def ath_for(token: str) -> str:
    return b64url(hashlib.sha256(token.encode()).digest())


class DPoPKey:
    """Simulates the browser's non-extractable WebCrypto ECDSA P-256 key."""

    def __init__(self) -> None:
        self.private = ec.generate_private_key(ec.SECP256R1())
        nums = self.private.public_key().public_numbers()
        self.jwk = {
            "kty": "EC",
            "crv": "P-256",
            "x": b64url(nums.x.to_bytes(32, "big")),
            "y": b64url(nums.y.to_bytes(32, "big")),
        }

    @property
    def thumbprint(self) -> str:
        canonical = json.dumps(
            {k: self.jwk[k] for k in ("crv", "kty", "x", "y")}, separators=(",", ":")
        )
        return b64url(hashlib.sha256(canonical.encode()).digest())

    def proof(
        self,
        method: str,
        path: str,
        *,
        access_token: str | None = None,
        iat: float | None = None,
        jti: str | None = None,
        htu: str | None = None,
        extra_claims: dict[str, Any] | None = None,
        header_overrides: dict[str, Any] | None = None,
        omit: tuple[str, ...] = (),
    ) -> str:
        claims: dict[str, Any] = {
            "jti": jti or str(uuid.uuid4()),
            "htm": method,
            "htu": htu or f"{API_BASE}{path}",
            "iat": int(time.time() if iat is None else iat),
        }
        if access_token is not None:
            claims["ath"] = ath_for(access_token)
        claims.update(extra_claims or {})
        for k in omit:
            claims.pop(k, None)
        headers: dict[str, Any] = {"typ": "dpop+jwt", "jwk": self.jwk}
        headers.update(header_overrides or {})
        return jwt.encode(claims, self.private, algorithm="ES256", headers=headers)


def forge_unsigned(claims: dict[str, Any], header: dict[str, Any]) -> str:
    h = b64url(json.dumps(header).encode())
    p = b64url(json.dumps(claims).encode())
    return f"{h}.{p}."


@dataclass
class FakeGoogle:
    """Minimal Google OIDC: /token (checks PKCE S256 + client creds) and /certs."""

    key: rsa.RSAPrivateKey = field(
        default_factory=lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048)
    )
    kid: str = "fake-kid-1"
    codes: dict[str, dict[str, Any]] = field(default_factory=dict)
    token_requests: list[dict[str, str]] = field(default_factory=list)

    def register_code(self, code: str, *, code_challenge: str, claims: dict[str, Any]) -> None:
        self.codes[code] = {"challenge": code_challenge, "claims": claims}

    def id_token(self, claims: dict[str, Any]) -> str:
        now = int(time.time())
        payload = {"iss": FAKE_ISSUER, "aud": GOOGLE_CLIENT_ID, "iat": now, "exp": now + 300}
        payload.update(claims)
        return jwt.encode(payload, self.key, algorithm="RS256", headers={"kid": self.kid})

    def app(self) -> FastAPI:
        api = FastAPI()

        @api.post("/token")
        async def token(request: Request) -> JSONResponse:
            form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
            grant_type = form.get("grant_type", "")
            code = form.get("code", "")
            redirect_uri = form.get("redirect_uri", "")
            client_id = form.get("client_id", "")
            client_secret = form.get("client_secret", "")
            code_verifier = form.get("code_verifier", "")
            self.token_requests.append(
                {"code": code, "redirect_uri": redirect_uri, "code_verifier": code_verifier}
            )
            entry = self.codes.pop(code, None)
            if (
                entry is None
                or grant_type != "authorization_code"
                or client_id != GOOGLE_CLIENT_ID
                or client_secret != GOOGLE_CLIENT_SECRET
            ):
                return JSONResponse({"error": "invalid_grant"}, status_code=400)
            challenge = b64url(hashlib.sha256(code_verifier.encode()).digest())
            if challenge != entry["challenge"]:
                return JSONResponse({"error": "invalid_grant"}, status_code=400)
            return JSONResponse(
                {"access_token": "ya29.fake", "id_token": self.id_token(entry["claims"])}
            )

        @api.get("/certs")
        async def certs() -> JSONResponse:
            jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            jwk.update({"kid": self.kid, "alg": "RS256", "use": "sig"})
            return JSONResponse({"keys": [jwk]})

        return api

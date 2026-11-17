"""OpenAPI contract vs spec §8, settings/production guards, password params (§4.1)."""

from __future__ import annotations

import base64
from typing import Any

import pytest
from argon2 import extract_parameters
from fastapi import FastAPI
from pydantic import ValidationError

from app.config import Environment, Settings
from app.security.passwords import PasswordService, password_policy_errors
from tests.conftest import make_settings


def _resolve(spec: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if ref:
        name = ref.rsplit("/", 1)[1]
        return spec["components"]["schemas"][name]  # type: ignore[no-any-return]
    return schema


def _body_props(spec: dict[str, Any], op: dict[str, Any]) -> set[str]:
    schema = _resolve(spec, op["requestBody"]["content"]["application/json"]["schema"])
    return set(schema["properties"])


def _resp_props(spec: dict[str, Any], op: dict[str, Any], code: str) -> set[str]:
    schema = _resolve(spec, op["responses"][code]["content"]["application/json"]["schema"])
    return set(schema["properties"])


def _params(op: dict[str, Any]) -> set[tuple[str, str]]:
    return {(p["in"], p["name"]) for p in op.get("parameters", [])}


def test_openapi_matches_spec_section_8(app: FastAPI):
    spec = app.openapi()
    paths = spec["paths"]
    assert set(paths) == {
        "/healthz",
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
        "/api/v1/auth/google/authorize",
        "/api/v1/auth/google/callback",
        "/api/v1/downloads/launcher",
        # Additions (email verification), see tests/test_email_verification.py
        "/api/v1/auth/verify-email",
        "/api/v1/auth/resend-verification",
        "/api/v1/auth/me",
    }
    token = {"access_token", "token_type", "expires_in"}

    reg = paths["/api/v1/auth/register"]["post"]
    assert _body_props(spec, reg) == {"email", "password"}
    assert _resp_props(spec, reg, "201") == token
    assert ("header", "DPoP") in _params(reg)

    log = paths["/api/v1/auth/login"]["post"]
    assert _body_props(spec, log) == {"email", "password"}
    assert _resp_props(spec, log, "200") == token
    assert _resp_props(spec, log, "401") == {"detail"}

    ref = paths["/api/v1/auth/refresh"]["post"]
    assert "requestBody" not in ref
    assert _resp_props(spec, ref, "200") == token
    assert {("header", "DPoP"), ("cookie", "__Secure-refresh-token")} <= _params(ref)

    out = paths["/api/v1/auth/logout"]["post"]
    assert "204" in out["responses"]

    auth = paths["/api/v1/auth/google/authorize"]["get"]
    assert _resp_props(spec, auth, "200") == {"authorization_url"}

    cb = paths["/api/v1/auth/google/callback"]["post"]
    assert _body_props(spec, cb) == {"code", "state"}
    assert _resp_props(spec, cb, "200") == token
    assert ("header", "DPoP") in _params(cb)

    dl = paths["/api/v1/downloads/launcher"]["get"]
    assert _resp_props(spec, dl, "200") == {"download_url", "sha256", "version", "expires_in"}
    assert _resp_props(spec, dl, "403") == {"detail"}
    assert {("header", "DPoP"), ("header", "authorization")} <= _params(dl)
    # No user-controlled query/path parameters on the download endpoint.
    assert not {p for p in _params(dl) if p[0] in {"query", "path"}}


# --- settings -------------------------------------------------------------------------
def test_defaults_use_it_domains():
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.api_public_base_url == "https://api.nztsolutions.it"
    assert s.portal_origins == ["https://clienti.nztsolutions.it"]
    assert s.storage_public_origin == "https://storage.nztsolutions.it"
    assert s.access_token_ttl_seconds == 600
    assert s.effective_db_sslmode == "disable"


def test_env_parsing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NZT_PORTAL_ORIGINS", "https://a.example, https://b.example")
    monkeypatch.setenv("NZT_TRUSTED_PROXY_CIDRS", "10.0.0.0/8,100.64.0.0/10")
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.portal_origins == ["https://a.example", "https://b.example"]
    assert s.trusted_proxy_cidrs == ["10.0.0.0/8", "100.64.0.0/10"]


def test_production_requires_secrets():
    with pytest.raises(ValidationError, match="production requires"):
        Settings(_env_file=None, environment="production")  # type: ignore[call-arg]


def test_production_defaults_verify_full_and_rejects_disable():
    key = base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("=")
    common: dict[str, Any] = {
        "environment": "production",
        "access_token_private_key_pem": "x",
        "oauth_state_key": key,
        "launcher_sha256": "ab" * 32,
        "trusted_proxy_cidrs": ["10.0.0.0/8"],
        "mail_backend": "resend",
        "resend_api_key": "re_test_key",
        "mail_from": "NZT Solutions <noreply@nztsolutions.it>",
    }
    ok = make_settings(**common, database_sslmode=None)
    assert ok.effective_db_sslmode == "verify-full"
    with pytest.raises(ValidationError, match="verify-full"):
        make_settings(**common, database_sslmode="disable")
    with pytest.raises(ValidationError, match="LAUNCHER_SHA256"):
        make_settings(**{**common, "launcher_sha256": "0" * 64})


def test_production_rejects_missing_signing_key_at_startup():
    from app.security.tokens import load_signing_key

    s = make_settings()
    s.environment = Environment.PRODUCTION
    with pytest.raises(RuntimeError):
        load_signing_key(s)


def test_settings_validation():
    with pytest.raises(ValidationError):
        make_settings(launcher_version="../../1.0")
    with pytest.raises(ValidationError):
        make_settings(api_public_base_url="https://api.example/with/path")
    with pytest.raises(ValidationError):
        make_settings(oauth_state_key="short")
    with pytest.raises(ValidationError):
        make_settings(access_token_ttl_seconds=3600)


def test_secrets_not_in_repr():
    s = make_settings()
    assert "test-google-client-secret" not in repr(s)
    assert "nzt_app_test" not in repr(s)


# --- passwords (spec §4.1) -------------------------------------------------------------
async def test_argon2id_parameters_and_verify():
    svc = PasswordService(2)
    h = await svc.hash("SuperSecurePassword123!")
    p = extract_parameters(h)
    assert (p.type.name, p.memory_cost, p.time_cost, p.parallelism) == ("ID", 65536, 3, 4)
    assert (p.salt_len, p.hash_len) == (16, 32)
    assert await svc.verify(h, "SuperSecurePassword123!")
    assert not await svc.verify(h, "WrongPassword123!")
    assert not await svc.verify("not-a-hash", "x")
    assert h != await svc.hash("SuperSecurePassword123!")  # random salt


def test_password_policy():
    assert password_policy_errors("SuperSecurePassword123!") == []
    assert password_policy_errors("short1!")
    assert password_policy_errors("NoDigitsHere!!!!")
    assert password_policy_errors("NoSpecials12345")
    assert password_policy_errors("x1!" * 50)  # > 128 chars

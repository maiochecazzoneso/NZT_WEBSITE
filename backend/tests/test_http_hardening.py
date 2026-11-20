"""Security headers (spec §9.1), CORS, docs in production, body limit, error hygiene."""

from __future__ import annotations

import httpx
import pytest
from fastapi import APIRouter, FastAPI

from app.main import create_app
from tests.conftest import make_settings
from tests.helpers import API_BASE, PORTAL_ORIGIN, DPoPKey

EXPECTED = {
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; connect-src 'self' https://accounts.google.com "
        "https://oauth2.googleapis.com https://api.nztsolutions.it "
        "https://clienti.nztsolutions.it https://storage.nztsolutions.it; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
    ),
    "cache-control": "no-store",
}


def _assert_headers(resp: httpx.Response) -> None:
    for name, value in EXPECTED.items():
        assert resp.headers.get(name) == value, (name, resp.status_code)


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("GET", "/healthz", {}),
        ("GET", "/does-not-exist", {}),
        ("POST", "/api/v1/auth/login", {"json": {"email": "bad"}}),  # 422
        ("POST", "/api/v1/auth/refresh", {}),  # 401
        ("GET", "/api/v1/downloads/launcher", {}),  # 401
        ("GET", "/api/v1/auth/google/authorize", {}),  # 200 + cookie
        ("POST", "/api/v1/auth/login", {"content": b"x" * 20000}),  # 413
    ],
)
async def test_security_headers_on_every_response(
    client: httpx.AsyncClient, method: str, path: str, kwargs: dict[str, object]
):
    resp = await client.request(method, path, **kwargs)  # type: ignore[arg-type]
    _assert_headers(resp)


async def test_healthz(client: httpx.AsyncClient):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_cors_preflight_portal_only(client: httpx.AsyncClient):
    ok = await client.options(
        "/api/v1/auth/refresh",
        headers={
            "Origin": PORTAL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "dpop, content-type",
        },
    )
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == PORTAL_ORIGIN
    assert ok.headers["access-control-allow-credentials"] == "true"
    allowed = {h.strip().lower() for h in ok.headers["access-control-allow-headers"].split(",")}
    assert {"dpop", "authorization", "content-type"} <= allowed
    _assert_headers(ok)

    evil = await client.options(
        "/api/v1/auth/refresh",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "dpop",
        },
    )
    assert evil.status_code == 400
    assert "access-control-allow-origin" not in evil.headers
    landing = await client.options(
        "/api/v1/auth/refresh",
        headers={"Origin": "https://nztsolutions.it", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in landing.headers

    bad_header = await client.options(
        "/api/v1/auth/refresh",
        headers={
            "Origin": PORTAL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-evil",
        },
    )
    assert bad_header.status_code == 400


async def test_cors_simple_request_exposes_only_retry_after(client: httpx.AsyncClient):
    resp = await client.get("/healthz", headers={"Origin": PORTAL_ORIGIN})
    assert resp.headers["access-control-allow-origin"] == PORTAL_ORIGIN
    # Review I6: only Retry-After is exposed (the portal shows the real wait time).
    assert resp.headers["access-control-expose-headers"] == "Retry-After"
    other = await client.get("/healthz", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers


async def test_docs_enabled_in_dev(client: httpx.AsyncClient):
    assert (await client.get("/openapi.json")).status_code == 200
    assert (await client.get("/docs")).status_code == 200


async def test_docs_disabled_in_production(monkeypatch: pytest.MonkeyPatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    pem = (
        Ed25519PrivateKey.generate()
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )
    settings = make_settings(
        environment="production",
        trusted_proxy_cidrs=["10.0.0.0/8"],
        access_token_private_key_pem=pem,
        oauth_state_key="A" * 43,
        launcher_sha256="ab" * 32,
        mail_backend="resend",
        resend_api_key="re_test_key",
        mail_from="NZT Solutions <noreply@nztsolutions.it>",
    )
    app = create_app(settings)
    # No lifespan needed: routing for docs is decided at construction time.
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c:
        for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
            resp = await c.get(path)
            assert resp.status_code == 404, path
            _assert_headers(resp)
    assert app.openapi_url is None
    assert app.docs_url is None
    assert app.redoc_url is None


async def test_body_size_limit(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/v1/auth/login",
        content=b"{" + b" " * 20000 + b"}",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 413
    assert resp.json() == {"detail": "Request body too large"}


async def test_body_size_limit_streamed(client: httpx.AsyncClient):
    async def gen():  # type: ignore[no-untyped-def]
        for _ in range(40):
            yield b" " * 1024

    resp = await client.post(
        "/api/v1/auth/register",
        content=gen(),
        headers={
            "Content-Type": "application/json",
            "DPoP": DPoPKey().proof("POST", "/api/v1/auth/register"),
        },
    )
    assert resp.status_code == 413


async def test_validation_errors_do_not_echo_input(client: httpx.AsyncClient):
    secret = "MyVerySecretPassword-ShouldNotLeak-123!"
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "not-an-email", "password": secret, "extra": "field"},
        headers={"DPoP": DPoPKey().proof("POST", "/api/v1/auth/login")},
    )
    assert resp.status_code == 422
    assert secret not in resp.text
    assert "input" not in resp.json()["detail"][0]


async def test_unhandled_error_has_no_stacktrace(app: FastAPI):
    boom = APIRouter()

    @boom.get("/boom")
    async def _boom() -> None:
        raise RuntimeError("secret-internal-detail")

    app.include_router(boom)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c:
        resp = await c.get("/boom")
    assert resp.status_code == 500
    assert resp.json() == {"detail": "Internal server error"}
    assert "secret-internal-detail" not in resp.text
    assert "Traceback" not in resp.text
    _assert_headers(resp)

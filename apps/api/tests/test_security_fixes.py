"""Regression tests for the independent security review (M1, L2, L3, L4, L6, I2, I3, I5,
I6, production configuration). Every test in this module FAILS on the code before the
fix (commit ed1795c) and passes after it; see the fix spec for the recorded evidence.
Real PostgreSQL + Redis, no mocks (the only patch is a frozen ``time.time`` in L3)."""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from typing import Any

import asyncpg
import httpx
import jwt
import pytest
from alembic import command
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi import APIRouter, FastAPI
from pydantic import ValidationError
from starlette.requests import Request

from app.client_ip import ClientIPResolver
from app.main import create_app
from app.security.dpop import DPoPError, DPoPValidator
from app.security.tokens import AccessTokenError, AccessTokenService
from tests.conftest import (
    ClientFactory,
    alembic_config,
    download,
    login,
    make_settings,
    refresh,
    refresh_cookie_of,
    register,
)
from tests.helpers import API_BASE, PORTAL_ORIGIN, STRONG_PASSWORD, DPoPKey, FakeGoogle, b64url
from tests.test_google import _authorize, _callback, _state_cookie

LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
REGISTER = "/api/v1/auth/register"


# --- M1 / I2: X-Forwarded-For --------------------------------------------------------
def test_m1_forged_left_entries_cannot_choose_the_client_ip():
    r = ClientIPResolver(["10.0.0.0/8"])
    real = "198.51.100.7"
    for n in (1, 31, 32, 33, 100, 1000):
        forged = ", ".join(f"7.7.{i // 250}.{i % 250}" for i in range(n))
        assert r.resolve("10.0.0.5", f"{forged}, {real}") == real, n
        # ... also behind several trusted hops appended by our own proxies.
        assert r.resolve("10.0.0.5", f"{forged}, {real}, 10.0.0.9, 10.0.0.8") == real, n


def test_m1_chain_of_only_trusted_hops_resolves_to_leftmost_examined_hop():
    r = ClientIPResolver(["10.0.0.0/8"])
    chain = ", ".join(f"10.0.{i // 250}.{i % 250}" for i in range(100))
    # 100 trusted hops: only the 32 rightmost are examined; never a client-chosen value.
    assert r.resolve("10.0.0.5", chain) == "10.0.0.68"


def _request_with_xff(lines: list[str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-for", v.encode()) for v in lines],
        "client": ("10.0.0.5", 1234),
    }
    return Request(scope)


def test_i2_all_x_forwarded_for_lines_are_combined():
    r = ClientIPResolver(["10.0.0.0/8"])
    # Client sent its own (forged) line; the edge appended a NEW line with the real IP.
    req = _request_with_xff(["6.6.6.6", "198.51.100.1"])
    assert r.for_request(req) == "198.51.100.1"
    req = _request_with_xff(["6.6.6.6, 5.5.5.5", "198.51.100.1, 10.0.0.7"])
    assert r.for_request(req) == "198.51.100.1"


async def test_m1_register_limit_not_bypassable_with_32_forged_hops(fake_google: FakeGoogle):
    settings = make_settings(trusted_proxy_cidrs=["10.0.0.0/8"])
    app = create_app(settings, http_transport=httpx.ASGITransport(app=fake_google.app()))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("10.1.2.3", 1))
        async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c:
            statuses = []
            for i in range(4):
                forged = ", ".join(f"7.7.{i}.{j}" for j in range(32))
                resp = await c.post(
                    REGISTER,
                    json={"email": f"m1-{i}@domain.com", "password": STRONG_PASSWORD},
                    headers={
                        "DPoP": DPoPKey().proof("POST", REGISTER),
                        "X-Forwarded-For": f"{forged}, 198.51.100.77",
                    },
                )
                statuses.append(resp.status_code)
    assert statuses == [201, 201, 201, 429]


# --- L2: DPoP / JWT numeric claim types ------------------------------------------------
def _raw_proof(key: DPoPKey, claims_json: str) -> str:
    """Sign an arbitrary claims JSON text (allows NaN/Infinity/huge ints like a hostile
    client would send)."""
    header = {"typ": "dpop+jwt", "alg": "ES256", "jwk": key.jwk}
    signing_input = (
        b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url(claims_json.encode())
    )
    der = key.private.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return signing_input + "." + b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def _claims_json(iat_literal: str, htu: str = API_BASE + LOGIN) -> str:
    return f'{{"jti":"{uuid.uuid4()}","htm":"POST","htu":"{htu}","iat":{iat_literal}}}'


BAD_IATS = [
    "NaN",
    "Infinity",
    "-Infinity",
    "1e400",  # -> inf
    "1" + "0" * 400,  # huge int: float() would raise OverflowError
    "true",
    '"1700000000"',
    "-5",
    "[1]",
    "{}",
]


@pytest.mark.parametrize("iat_literal", BAD_IATS)
async def test_l2_dpop_bad_iat_is_invalid_proof(app: FastAPI, iat_literal: str):
    validator: DPoPValidator = app.state.services.dpop
    proof = _raw_proof(DPoPKey(), _claims_json(iat_literal))
    with pytest.raises(DPoPError):
        await validator.validate(proof, method="POST", path=LOGIN)


@pytest.mark.parametrize("iat_literal", ["NaN", "1" + "0" * 400])
async def test_l2_dpop_bad_iat_is_401_over_http(client: httpx.AsyncClient, iat_literal: str):
    proof = _raw_proof(DPoPKey(), _claims_json(iat_literal))
    resp = await client.post(
        LOGIN, json={"email": "a@domain.com", "password": "x"}, headers={"DPoP": proof}
    )
    assert resp.status_code == 401, resp.text
    assert resp.json() == {"detail": "Invalid DPoP proof"}


async def test_l2_dpop_float_iat_within_window_still_accepted(app: FastAPI):
    validator: DPoPValidator = app.state.services.dpop
    proof = _raw_proof(DPoPKey(), _claims_json(repr(time.time() - 1.5)))
    assert (await validator.validate(proof, method="POST", path=LOGIN)).iat > 0


async def test_l2_dpop_malformed_htu_is_invalid_proof(app: FastAPI):
    validator: DPoPValidator = app.state.services.dpop
    key = DPoPKey()
    for htu in ("http://[::1/api/v1/auth/login", "https://[zz]/x"):
        proof = _raw_proof(key, _claims_json(str(int(time.time())), htu=htu))
        with pytest.raises(DPoPError):
            await validator.validate(proof, method="POST", path=LOGIN)


@pytest.mark.parametrize(
    ("claim", "value"),
    [("iat", True), ("iat", "1700000000"), ("exp", 1.5e12), ("iat_ms", "1"), ("jti", 7)],
)
def test_l2_access_token_claim_types_are_strict(app: FastAPI, claim: str, value: Any):
    tokens: AccessTokenService = app.state.services.tokens
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": str(uuid.uuid4()),
        "iss": API_BASE,
        "iat": now,
        "exp": now + 600,
        "jti": str(uuid.uuid4()),
        "cnf": {"jkt": "x" * 43},
        "iat_ms": now * 1000,
        claim: value,
    }
    token = jwt.encode(
        payload, tokens._key, algorithm="EdDSA", headers={"kid": tokens.kid, "typ": "at+jwt"}
    )
    with pytest.raises(AccessTokenError):
        tokens.verify(token)


# --- L3: same-second re-login after a revocation -------------------------------------
@pytest.fixture
def frozen_time(monkeypatch: pytest.MonkeyPatch) -> float:
    """Freeze the LOCAL wall clock (time.time) to one value so every step below happens
    'in the same second'. Redis TIME is untouched (that is the point of the fix)."""
    frozen = float(int(time.time())) + 0.5
    monkeypatch.setattr(time, "time", lambda: frozen)
    return frozen


async def test_l3_same_second_relogin_after_logout_is_accepted(
    client: httpx.AsyncClient, frozen_time: float
):
    key = DPoPKey()
    reg = await register(client, key)
    old_token = reg.json()["access_token"]
    out = await client.post(LOGOUT, headers={"DPoP": key.proof("POST", LOGOUT)})
    assert out.status_code == 204
    # Token minted BEFORE the logout is dead (revocation not weakened) ...
    assert (await download(client, key, old_token)).status_code == 401
    # ... while a login with the SAME key in the SAME second is a new, valid session.
    again = await login(client, key)
    assert again.status_code == 200
    resp = await download(client, key, again.json()["access_token"])
    assert resp.status_code == 403, resp.text  # authenticated; just no entitlement


async def test_l3_same_second_relogin_after_reuse_revocation_is_accepted(
    client_factory: ClientFactory, frozen_time: float
):
    c = client_factory()
    key = DPoPKey()
    first = refresh_cookie_of(await register(c, key))
    other_key = DPoPKey()
    other = await login(client_factory("198.51.100.98"), other_key)
    other_token = other.json()["access_token"]
    assert (await refresh(c, key, cookie=first)).status_code == 200
    assert (await refresh(c, key, cookie=first)).status_code == 401  # reuse => revoke all
    # Pre-revocation token of another device: dead.
    assert (await download(c, other_key, other_token)).status_code == 401
    # Legitimate re-login straight after the reuse event, same second: accepted.
    new_key = DPoPKey()
    relog = await login(client_factory("198.51.100.97"), new_key)
    assert relog.status_code == 200
    resp = await download(c, new_key, relog.json()["access_token"])
    assert resp.status_code == 403, resp.text


async def test_l3_refresh_issued_before_revocation_is_rejected(
    client_factory: ClientFactory, frozen_time: float
):
    c = client_factory()
    key = DPoPKey()
    reg = await register(c, key)
    rotated = await refresh(c, key, cookie=refresh_cookie_of(reg))
    token = rotated.json()["access_token"]
    out = await c.post(LOGOUT, headers={"DPoP": key.proof("POST", LOGOUT)})
    assert out.status_code == 204
    assert (await download(c, key, token)).status_code == 401


# --- L4: bounded Argon2 queue --------------------------------------------------------
async def test_l4_password_queue_is_bounded_and_fails_fast(fake_google: FakeGoogle):
    settings = make_settings(argon2_max_concurrency=1, argon2_max_queue=2)
    app = create_app(settings, http_transport=httpx.ASGITransport(app=fake_google.app()))
    async with app.router.lifespan_context(app):

        async def bogus(i: int) -> tuple[int, str | None, float]:
            transport = httpx.ASGITransport(app=app, client=(f"198.18.{i // 250}.{i % 250}", 1))
            async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c:
                t0 = time.perf_counter()
                r = await c.post(
                    LOGIN,
                    json={"email": f"flood{i}@domain.com", "password": "WrongPassword123!"},
                    headers={"DPoP": DPoPKey().proof("POST", LOGIN)},
                )
                return r.status_code, r.headers.get("retry-after"), time.perf_counter() - t0

        results = await asyncio.gather(*(bogus(i) for i in range(24)))
    statuses = [s for s, _, _ in results]
    shed = [r for r in results if r[0] == 503]
    assert set(statuses) <= {401, 503}, statuses
    assert statuses.count(401) >= 3  # 1 running + 2 queued were served
    assert shed, "queue must be bounded: expected fast 503s under the flood"
    assert all(retry == "1" for _, retry, _ in shed)


# --- L6: Google endpoints rate limited + single-use state -----------------------------
async def test_l6_oauth_state_is_single_use(client: httpx.AsyncClient, fake_google: FakeGoogle):
    auth, params = await _authorize(client)
    cookie = _state_cookie(auth)
    claims = {"sub": "g-l6", "email": "l6@gmail.com", "email_verified": True}
    fake_google.register_code(
        "code-l6",
        code_challenge=params["code_challenge"],
        claims={"nonce": params["nonce"], **claims},
    )
    first = await _callback(
        client, DPoPKey(), code="code-l6", state=params["state"], state_cookie=cookie
    )
    assert first.status_code == 200, first.text
    for _ in range(3):
        again = await _callback(
            client, DPoPKey(), code="code-l6", state=params["state"], state_cookie=cookie
        )
        assert again.status_code == 400
        assert again.json() == {"detail": "OAuth state already used"}
    assert len(fake_google.token_requests) == 1  # replays never reach Google


async def test_l6_google_callback_rate_limited_per_ip(client_factory: ClientFactory):
    c = client_factory("198.51.100.66")
    codes = []
    for _ in range(11):
        r = await _callback(c, DPoPKey(), code="x", state="y", state_cookie=None)
        codes.append(r.status_code)
    assert codes[:10] == [400] * 10
    assert codes[10] == 429
    assert int(r.headers["retry-after"]) >= 1
    other = await _callback(
        client_factory("198.51.100.67"), DPoPKey(), code="x", state="y", state_cookie=None
    )
    assert other.status_code == 400


async def test_l6_google_authorize_rate_limited_per_ip(client_factory: ClientFactory):
    c = client_factory("198.51.100.68")
    codes = [(await c.get("/api/v1/auth/google/authorize")).status_code for _ in range(21)]
    assert codes[:20] == [200] * 20
    assert codes[20] == 429


# --- I3: strict canonical base64url JWK -------------------------------------------------
def _flip_unused_bits(coord: str) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    last = alphabet.index(coord[-1])
    return coord[:-1] + alphabet[last ^ 0b01]  # same 32 bytes, different spelling


async def test_i3_non_canonical_jwk_coordinates_rejected(app: FastAPI):
    validator: DPoPValidator = app.state.services.dpop
    key = DPoPKey()
    variant = _flip_unused_bits(key.jwk["x"])
    assert base64.urlsafe_b64decode(variant + "=") == base64.urlsafe_b64decode(key.jwk["x"] + "=")
    proof = key.proof("POST", LOGIN, header_overrides={"jwk": {**key.jwk, "x": variant}})
    with pytest.raises(DPoPError):
        await validator.validate(proof, method="POST", path=LOGIN)
    # The canonical spelling of the same key is still fine.
    ok = await validator.validate(key.proof("POST", LOGIN), method="POST", path=LOGIN)
    assert ok.jkt == key.thumbprint


# --- I5: Google emails canonicalised exactly like local emails --------------------------
async def test_i5_idn_google_email_links_to_the_local_account(
    client: httpx.AsyncClient, fake_google: FakeGoogle, migrator_conn: asyncpg.Connection
):
    reg = await register(client, DPoPKey(), email="Victim@XN--EXMPLE-CUA.com")
    assert reg.status_code == 201
    stored = await migrator_conn.fetchval("SELECT email FROM users")
    assert stored == "victim@exämple.com"
    await migrator_conn.execute("UPDATE users SET is_verified = TRUE")
    auth, params = await _authorize(client)
    fake_google.register_code(
        "code-i5",
        code_challenge=params["code_challenge"],
        claims={
            "nonce": params["nonce"],
            "sub": "g-i5",
            "email": "victim@xn--exmple-cua.com",
            "email_verified": True,
        },
    )
    resp = await _callback(
        client, DPoPKey(), code="code-i5", state=params["state"], state_cookie=_state_cookie(auth)
    )
    assert resp.status_code == 200, resp.text
    assert await migrator_conn.fetchval("SELECT count(*) FROM users") == 1
    linked = await migrator_conn.fetchval(
        "SELECT count(*) FROM auth_identities WHERE provider = 'google'"
    )
    assert linked == 1


async def test_i5_invalid_google_email_rejected(
    client: httpx.AsyncClient, fake_google: FakeGoogle, migrator_conn: asyncpg.Connection
):
    auth, params = await _authorize(client)
    fake_google.register_code(
        "code-i5b",
        code_challenge=params["code_challenge"],
        claims={
            "nonce": params["nonce"],
            "sub": "g-i5b",
            "email": "not an email",
            "email_verified": True,
        },
    )
    resp = await _callback(
        client, DPoPKey(), code="code-i5b", state=params["state"], state_cookie=_state_cookie(auth)
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "id_token has no usable email"}
    assert await migrator_conn.fetchval("SELECT count(*) FROM users") == 0


# --- I6: CORS on every error + Retry-After exposed ---------------------------------------
async def test_i6_cors_headers_on_413_429_500(app: FastAPI, client_factory: ClientFactory):
    origin = {"Origin": PORTAL_ORIGIN}
    c = client_factory("198.51.100.55")
    too_big = await c.post(
        LOGIN, content=b"x" * 20000, headers={**origin, "Content-Type": "application/json"}
    )
    assert too_big.status_code == 413
    assert too_big.headers.get("access-control-allow-origin") == PORTAL_ORIGIN

    for i in range(6):
        limited = await c.post(
            LOGIN,
            json={"email": f"i6-{i}@domain.com", "password": "x"},
            headers={**origin, "DPoP": DPoPKey().proof("POST", LOGIN)},
        )
    assert limited.status_code == 429
    assert limited.headers.get("access-control-allow-origin") == PORTAL_ORIGIN
    assert "retry-after" in limited.headers.get("access-control-expose-headers", "").lower()

    boom = APIRouter()

    @boom.get("/boom-i6")
    async def _boom() -> None:
        raise RuntimeError("boom")

    app.include_router(boom)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c2:
        err = await c2.get("/boom-i6", headers=origin)
    assert err.status_code == 500
    assert err.json() == {"detail": "Internal server error"}
    assert err.headers.get("access-control-allow-origin") == PORTAL_ORIGIN
    assert err.headers.get("x-frame-options") == "DENY"  # security headers still applied


# --- production configuration --------------------------------------------------------
def _prod(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "environment": "production",
        "access_token_private_key_pem": "x",
        "oauth_state_key": base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("="),
        "launcher_sha256": "ab" * 32,
        "database_sslmode": "verify-full",
        "trusted_proxy_cidrs": ["10.0.0.0/8"],
        "mail_backend": "resend",
        "resend_api_key": "re_test_key",
        "mail_from": "NZT Solutions <noreply@nztsolutions.it>",
    }
    base.update(over)
    return base


def test_prod_config_valid_baseline():
    s = make_settings(**_prod())
    assert s.is_production
    assert make_settings(**_prod(trusted_proxy_cidrs=[], direct_client_connections=True))


@pytest.mark.parametrize("mode", ["verify-ca", "require", "disable"])
def test_prod_requires_sslmode_verify_full(mode: str):
    with pytest.raises(ValidationError, match="verify-full"):
        make_settings(**_prod(database_sslmode=mode))


def test_prod_requires_trusted_proxies_or_explicit_opt_in():
    with pytest.raises(ValidationError, match="NZT_TRUSTED_PROXY_CIDRS"):
        make_settings(**_prod(trusted_proxy_cidrs=[]))
    with pytest.raises(ValidationError, match="not both"):
        make_settings(**_prod(direct_client_connections=True))


def test_prod_requires_https_storage_endpoint():
    with pytest.raises(ValidationError, match="STORAGE_ENDPOINT_URL"):
        make_settings(**_prod(storage_endpoint_url="http://storage.internal:9000"))


@pytest.mark.parametrize(
    ("field", "env"),
    [
        ("database_url", "NZT_DATABASE_URL"),
        ("redis_url", "NZT_REDIS_URL"),
    ],
)
def test_prod_requires_explicit_infrastructure_urls(
    monkeypatch: pytest.MonkeyPatch, field: str, env: str
):
    from app.config import Settings

    for name in ("NZT_DATABASE_URL", "NZT_MIGRATIONS_DATABASE_URL", "NZT_REDIS_URL"):
        monkeypatch.delenv(name, raising=False)
    explicit = {
        "database_url": "postgresql://nzt_app:x@db.internal:5432/nzt",
        "redis_url": "rediss://default:x@redis.internal:6379/0",
    }
    explicit.pop(field)
    kwargs = {
        **_prod(),
        **explicit,
        "google_client_id": "id",
        "google_client_secret": "secret",
        "storage_access_key_id": "a",
        "storage_secret_access_key": "b",
    }
    with pytest.raises(ValidationError, match=env):
        Settings(_env_file=None, **kwargs)  # type: ignore[call-arg]
    # The same value supplied through the environment counts as explicit.
    monkeypatch.setenv(env, "postgresql://u:p@h:5432/d" if "DATABASE" in env else "redis://h:1/0")
    assert Settings(_env_file=None, **kwargs).is_production  # type: ignore[call-arg]


def _prod_kwargs() -> dict[str, Any]:
    return {
        **_prod(),
        "database_url": "postgresql://nzt_app:x@db.internal:5432/nzt",
        "redis_url": "rediss://default:x@redis.internal:6379/0",
        "google_client_id": "id",
        "google_client_secret": "secret",
        "storage_access_key_id": "a",
        "storage_secret_access_key": "b",
    }


def test_prod_does_not_require_migrations_url(monkeypatch: pytest.MonkeyPatch):
    """The API service must not hold the migrator credentials: production Settings() is
    valid without NZT_MIGRATIONS_DATABASE_URL."""
    from app.config import Settings

    monkeypatch.delenv("NZT_MIGRATIONS_DATABASE_URL", raising=False)
    s = Settings(_env_file=None, **_prod_kwargs())  # type: ignore[call-arg]
    assert s.is_production
    assert s.migrations_database_url is None


def test_alembic_in_production_requires_migrations_url(monkeypatch: pytest.MonkeyPatch):
    """alembic keeps requiring the migrator URL in production and fails with a clear error
    (no silent fallback to the runtime role)."""
    from app.config import Settings

    kwargs = _prod_kwargs()
    # Settings() inside alembic/env.py reads the process environment: provide a valid
    # production environment minus the migrations URL.
    env = {
        "NZT_ENVIRONMENT": "production",
        "NZT_ACCESS_TOKEN_PRIVATE_KEY_PEM": kwargs["access_token_private_key_pem"],
        "NZT_OAUTH_STATE_KEY": kwargs["oauth_state_key"],
        "NZT_LAUNCHER_SHA256": kwargs["launcher_sha256"],
        "NZT_DATABASE_SSLMODE": "verify-full",
        "NZT_TRUSTED_PROXY_CIDRS": "10.0.0.0/8",
        "NZT_DATABASE_URL": kwargs["database_url"],
        "NZT_REDIS_URL": kwargs["redis_url"],
        "NZT_GOOGLE_CLIENT_ID": "id",
        "NZT_GOOGLE_CLIENT_SECRET": "secret",
        "NZT_STORAGE_ACCESS_KEY_ID": "a",
        "NZT_STORAGE_SECRET_ACCESS_KEY": "b",
        "NZT_MAIL_BACKEND": "resend",
        "NZT_RESEND_API_KEY": kwargs["resend_api_key"],
        "NZT_MAIL_FROM": kwargs["mail_from"],
    }
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("NZT_MIGRATIONS_DATABASE_URL", raising=False)
    monkeypatch.chdir("/")  # no stray .env
    assert Settings().is_production  # the environment above is a valid production config

    cfg = alembic_config()
    del cfg.attributes["database_url"]  # exercise the real URL resolution
    with pytest.raises(RuntimeError, match="NZT_MIGRATIONS_DATABASE_URL is required"):
        command.upgrade(cfg, "head", sql=True)  # offline mode: never touches a database

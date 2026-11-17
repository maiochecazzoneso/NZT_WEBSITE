"""Test fixtures against REAL PostgreSQL 16 + Redis 7 (no mocks for DB/Redis).

Start them with ``scripts/test-services.sh start`` (native binaries) or
``docker compose -f docker-compose.test.yml up -d``. Endpoints can be overridden with
NZT_TEST_PG_HOST/PORT, NZT_TEST_REDIS_URL."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import asyncpg
import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from tests.helpers import (
    API_BASE,
    FAKE_IDP,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    PORTAL_ORIGIN,
    STRONG_PASSWORD,
    DPoPKey,
    FakeGoogle,
)

ROOT = Path(__file__).resolve().parents[1]
PG_HOST = os.environ.get("NZT_TEST_PG_HOST", "127.0.0.1")
PG_PORT = int(os.environ.get("NZT_TEST_PG_PORT", "55432"))
PG_DB = os.environ.get("NZT_TEST_PG_DB", "nzt_test")
APP_DSN = f"postgresql://nzt_app:nzt_app_test@{PG_HOST}:{PG_PORT}/{PG_DB}"
MIGRATOR_DSN = f"postgresql://nzt_migrator:nzt_migrator_test@{PG_HOST}:{PG_PORT}/{PG_DB}"
REDIS_URL = os.environ.get("NZT_TEST_REDIS_URL", "redis://127.0.0.1:56379/15")
DEFAULT_IP = "203.0.113.10"
TABLES = (
    "download_logs",
    "entitlements",
    "refresh_tokens",
    "refresh_token_families",
    "auth_identities",
    "users",
)


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "environment": "test",
        "database_url": SecretStr(APP_DSN),
        "migrations_database_url": SecretStr(MIGRATOR_DSN),
        "database_sslmode": "disable",
        "redis_url": SecretStr(REDIS_URL),
        "api_public_base_url": API_BASE,
        "portal_origins": [PORTAL_ORIGIN],
        "google_client_id": GOOGLE_CLIENT_ID,
        "google_client_secret": SecretStr(GOOGLE_CLIENT_SECRET),
        "google_authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
        "google_token_endpoint": f"{FAKE_IDP}/token",
        "google_jwks_uri": f"{FAKE_IDP}/certs",
        "storage_endpoint_url": "https://storage.nztsolutions.it",
        "storage_bucket": "nzt-binaries",
        "storage_access_key_id": SecretStr("AKIDTESTONLY"),
        "storage_secret_access_key": SecretStr("test-only-secret"),
        "launcher_version": "1.0.0",
        "launcher_sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


def alembic_config(url: str = MIGRATOR_DSN) -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    cfg.attributes["database_url"] = url
    cfg.attributes["configure_logging"] = False
    return cfg


@pytest.fixture(scope="session", autouse=True)
def _migrated_db() -> None:
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
async def _clean_state() -> None:
    conn = await asyncpg.connect(MIGRATOR_DSN)
    try:
        await conn.execute("TRUNCATE " + ", ".join(TABLES) + " CASCADE")
    finally:
        await conn.close()
    import redis.asyncio as aioredis

    r = aioredis.Redis.from_url(REDIS_URL)
    await r.flushdb()
    await r.aclose()


@pytest.fixture
async def migrator_conn() -> AsyncIterator[asyncpg.Connection]:
    conn = await asyncpg.connect(MIGRATOR_DSN)
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
def fake_google() -> FakeGoogle:
    return FakeGoogle()


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
async def app(settings: Settings, fake_google: FakeGoogle) -> AsyncIterator[FastAPI]:
    application = create_app(settings, http_transport=httpx.ASGITransport(app=fake_google.app()))
    async with application.router.lifespan_context(application):
        yield application


ClientFactory = Callable[..., httpx.AsyncClient]


@pytest.fixture
async def client_factory(app: FastAPI) -> AsyncIterator[ClientFactory]:
    clients: list[httpx.AsyncClient] = []

    def factory(ip: str = DEFAULT_IP) -> httpx.AsyncClient:
        c = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=(ip, 51234)),
            base_url=API_BASE,
        )
        clients.append(c)
        return c

    yield factory
    for c in clients:
        await c.aclose()


@pytest.fixture
def client(client_factory: ClientFactory) -> httpx.AsyncClient:
    return client_factory()


# --- flow helpers --------------------------------------------------------------------
async def register(
    client: httpx.AsyncClient,
    key: DPoPKey,
    email: str = "user@domain.com",
    password: str = STRONG_PASSWORD,
) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
        headers={"DPoP": key.proof("POST", "/api/v1/auth/register")},
    )


async def login(
    client: httpx.AsyncClient,
    key: DPoPKey,
    email: str = "user@domain.com",
    password: str = STRONG_PASSWORD,
) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"DPoP": key.proof("POST", "/api/v1/auth/login")},
    )


async def refresh(
    client: httpx.AsyncClient, key: DPoPKey, cookie: str | None = None
) -> httpx.Response:
    headers = {"DPoP": key.proof("POST", "/api/v1/auth/refresh")}
    if cookie is not None:
        client.cookies.clear()
        headers["Cookie"] = f"__Secure-refresh-token={cookie}"
    return await client.post("/api/v1/auth/refresh", headers=headers)


async def download(client: httpx.AsyncClient, key: DPoPKey, token: str) -> httpx.Response:
    path = "/api/v1/downloads/launcher"
    return await client.get(
        path,
        headers={
            "Authorization": f"DPoP {token}",
            "DPoP": key.proof("GET", path, access_token=token),
        },
    )


def refresh_cookie_of(resp: httpx.Response) -> str:
    for header in resp.headers.get_list("set-cookie"):
        if header.startswith("__Secure-refresh-token="):
            return header.split(";", 1)[0].split("=", 1)[1]
    raise AssertionError("no refresh cookie set")


async def create_user(
    conn: asyncpg.Connection,
    email: str,
    *,
    password_hash: str | None = None,
    is_verified: bool = False,
    is_active: bool = True,
) -> uuid.UUID:
    user_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO users (id, email, password_hash, is_verified, is_active) "
        "VALUES ($1, $2, $3, $4, $5)",
        user_id,
        email,
        password_hash,
        is_verified,
        is_active,
    )
    return user_id


async def grant(
    conn: asyncpg.Connection,
    user_id: uuid.UUID,
    product_code: str = "launcher_core",
    *,
    is_enabled: bool = True,
    valid_until: datetime | None = None,
) -> None:
    await conn.execute(
        "INSERT INTO entitlements (user_id, product_code, is_enabled, valid_until) "
        "VALUES ($1, $2, $3, $4)",
        user_id,
        product_code,
        is_enabled,
        valid_until,
    )

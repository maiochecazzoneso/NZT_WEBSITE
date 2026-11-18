"""Test fixtures against a REAL MongoDB 8 replica set + Redis 7 (no mocks for DB/Redis).

Start them with ``scripts/test-services.sh start`` (native binaries) or
``docker compose -f docker-compose.test.yml up -d``. Endpoints can be overridden with
NZT_TEST_MONGO_HOST/PORT, NZT_TEST_REDIS_URL.

``mongo`` is a connection as the SCHEMA user (nzt_migrator, the old migrator_conn): tests
use it to prepare and inspect documents; the API itself runs as the least-privilege
nzt_app user."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from app.config import Settings
from app.db import (
    PROVIDER_LOCAL,
    ROLE_CUSTOMER,
    Collections,
    create_client,
    identity_document,
    user_document,
    utcnow,
)
from app.main import create_app
from app.schema import SPECS, apply_schema
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

MONGO_HOST = os.environ.get("NZT_TEST_MONGO_HOST", "127.0.0.1")
MONGO_PORT = int(os.environ.get("NZT_TEST_MONGO_PORT", "57017"))
MONGO_DB = os.environ.get("NZT_TEST_MONGO_DB", "nzt_test")
_OPTS = f"authSource={MONGO_DB}&directConnection=true"
APP_URI = f"mongodb://nzt_app:nzt_app_test@{MONGO_HOST}:{MONGO_PORT}/?{_OPTS}"
MIGRATOR_URI = f"mongodb://nzt_migrator:nzt_migrator_test@{MONGO_HOST}:{MONGO_PORT}/?{_OPTS}"
REDIS_URL = os.environ.get("NZT_TEST_REDIS_URL", "redis://127.0.0.1:56379/15")
DEFAULT_IP = "203.0.113.10"


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "environment": "test",
        "mongodb_uri": SecretStr(APP_URI),
        "mongodb_migrations_uri": SecretStr(MIGRATOR_URI),
        "mongodb_database": MONGO_DB,
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
        "mail_backend": "memory",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


@pytest.fixture(scope="session", autouse=True)
def _schema() -> None:
    async def apply() -> None:
        client = create_client(make_settings(), uri=MIGRATOR_URI)
        try:
            await apply_schema(client[MONGO_DB])
        finally:
            await client.close()

    asyncio.run(apply())


@pytest.fixture
async def mongo() -> AsyncIterator[Collections]:
    client = create_client(make_settings(), uri=MIGRATOR_URI)
    try:
        yield Collections.of(client[MONGO_DB])
    finally:
        await client.close()


@pytest.fixture(autouse=True)
async def _clean_state(mongo: Collections) -> None:
    db = mongo.users.database
    for spec in SPECS:
        await db[spec.name].delete_many({})
    import redis.asyncio as aioredis

    r = aioredis.Redis.from_url(REDIS_URL)
    await r.flushdb()
    await r.aclose()


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
    db: Collections,
    email: str,
    *,
    password_hash: str | None = None,
    is_verified: bool = False,
    is_active: bool = True,
    role: str = ROLE_CUSTOMER,
    local_identity: bool = False,
) -> uuid.UUID:
    now = utcnow()
    doc = user_document(
        email=email,
        password_hash=password_hash,
        is_verified=is_verified,
        identities=[identity_document(PROVIDER_LOCAL, email, now)] if local_identity else [],
        now=now,
        role=role,
    )
    doc["isActive"] = is_active
    await db.users.insert_one(doc)
    user_id: uuid.UUID = doc["_id"]
    return user_id


async def grant(
    db: Collections,
    user_id: uuid.UUID,
    product_code: str = "launcher_core",
    *,
    is_enabled: bool = True,
    valid_until: datetime | None = None,
) -> None:
    entitlement = {
        "productCode": product_code,
        "isEnabled": is_enabled,
        "validUntil": valid_until,
        "createdAt": utcnow(),
    }
    await db.users.update_one({"_id": user_id}, {"$push": {"entitlements": entitlement}})


async def only_user_id(db: Collections) -> uuid.UUID:
    users = await db.users.find({}, {"_id": 1}).to_list()
    assert len(users) == 1, users
    user_id: uuid.UUID = users[0]["_id"]
    return user_id


async def one(collection: Any, query: dict[str, Any] | None = None) -> dict[str, Any]:
    docs = await collection.find(query or {}).to_list()
    assert len(docs) == 1, docs
    doc: dict[str, Any] = docs[0]
    return doc

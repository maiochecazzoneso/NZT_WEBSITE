"""Entitlements + launcher download + audit log (spec §7, §8.5, D-A13)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import asyncpg
import httpx
import pytest
from fastapi import FastAPI

from app.deps import has_active_entitlement
from app.services.storage import Product, artifact_catalog
from tests.conftest import DEFAULT_IP, download, grant, register
from tests.helpers import DPoPKey

LAUNCHER_SHA = "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"


async def _user(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> tuple[DPoPKey, str, uuid.UUID]:
    key = DPoPKey()
    resp = await register(client, key)
    return key, resp.json()["access_token"], await conn.fetchval("SELECT id FROM users")


async def test_download_allowed(client: httpx.AsyncClient, migrator_conn: asyncpg.Connection):
    key, token, user_id = await _user(client, migrator_conn)
    await grant(migrator_conn, user_id)
    resp = await client.get(
        "/api/v1/downloads/launcher?version=../../etc/passwd&key=evil",
        headers={
            "Authorization": f"DPoP {token}",
            "DPoP": key.proof("GET", "/api/v1/downloads/launcher", access_token=token),
            "User-Agent": "NZT-Test/1.0",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"download_url", "sha256", "version", "expires_in"}
    assert body["sha256"] == LAUNCHER_SHA
    assert body["version"] == "1.0.0"
    assert body["expires_in"] == 300

    url = urlsplit(body["download_url"])
    q = parse_qs(url.query)
    assert url.scheme == "https"
    assert url.netloc == "storage.nztsolutions.it"
    assert url.path == "/nzt-binaries/binaries/launcher/v1.0.0/NZT-Launcher.exe"
    assert "passwd" not in body["download_url"]
    assert "evil" not in body["download_url"]
    assert q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert q["X-Amz-Expires"] == ["300"]
    assert len(q["X-Amz-Signature"][0]) == 64
    assert q["response-content-disposition"] == ['attachment; filename="NZT-Launcher.exe"']

    log = await migrator_conn.fetchrow("SELECT * FROM download_logs")
    assert log["user_id"] == user_id
    assert log["product_code"] == "launcher_core"
    assert str(log["ip_address"]) == DEFAULT_IP
    assert log["user_agent"] == "NZT-Test/1.0"
    assert len(log["download_token_id"]) == 32


@pytest.mark.parametrize(
    ("is_enabled", "valid_until_delta", "expected"),
    [
        (True, None, 200),  # lifetime licence
        (True, timedelta(days=30), 200),
        (False, None, 403),  # disabled
        (True, timedelta(seconds=-1), 403),  # expired
    ],
)
async def test_entitlement_matrix(
    client: httpx.AsyncClient,
    migrator_conn: asyncpg.Connection,
    is_enabled: bool,
    valid_until_delta: timedelta | None,
    expected: int,
):
    key, token, user_id = await _user(client, migrator_conn)
    valid_until = datetime.now(UTC) + valid_until_delta if valid_until_delta else None
    await grant(migrator_conn, user_id, is_enabled=is_enabled, valid_until=valid_until)
    resp = await download(client, key, token)
    assert resp.status_code == expected
    if expected == 403:
        assert resp.json() == {"detail": "User does not have active entitlement for launcher_core"}
        assert await migrator_conn.fetchval("SELECT count(*) FROM download_logs") == 0
    else:
        assert await migrator_conn.fetchval("SELECT count(*) FROM download_logs") == 1


async def test_entitlement_missing_or_other_product(
    client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    key, token, user_id = await _user(client, migrator_conn)
    resp = await download(client, key, token)
    assert resp.status_code == 403
    assert resp.json() == {"detail": "User does not have active entitlement for launcher_core"}
    await grant(migrator_conn, user_id, "nzt_suite")
    assert (await download(client, key, token)).status_code == 403


async def test_require_entitlement_helper(app: FastAPI, migrator_conn: asyncpg.Connection):
    user_id = uuid.uuid4()
    await migrator_conn.execute("INSERT INTO users (id, email) VALUES ($1, 'e@d.com')", user_id)
    await grant(migrator_conn, user_id, "nzt_suite")
    async with app.state.sessionmaker() as db:
        assert await has_active_entitlement(db, user_id, "nzt_suite")
        assert not await has_active_entitlement(db, user_id, "launcher_core")


async def test_audit_rows_survive_user_deletion(
    client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    key, token, user_id = await _user(client, migrator_conn)
    await grant(migrator_conn, user_id)
    assert (await download(client, key, token)).status_code == 200
    await migrator_conn.execute("DELETE FROM users WHERE id = $1", user_id)
    row = await migrator_conn.fetchrow("SELECT user_id, product_code FROM download_logs")
    assert row["user_id"] is None
    assert row["product_code"] == "launcher_core"


def test_catalog_is_server_side_only(settings):  # type: ignore[no-untyped-def]
    catalog = artifact_catalog(settings)
    assert set(catalog) == {Product.LAUNCHER_CORE}
    art = catalog[Product.LAUNCHER_CORE]
    assert art.object_key == "binaries/launcher/v1.0.0/NZT-Launcher.exe"

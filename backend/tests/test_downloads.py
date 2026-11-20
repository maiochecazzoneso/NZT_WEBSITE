"""Entitlements + launcher download + audit log (spec §7, §8.5, D-A13)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.db import Collections
from app.deps import AuthenticatedUser, Entitlement, has_active_entitlement
from app.services.storage import Product, artifact_catalog
from tests.conftest import DEFAULT_IP, download, grant, one, only_user_id, register
from tests.helpers import DPoPKey

LAUNCHER_SHA = "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"


async def _user(client: httpx.AsyncClient, db: Collections) -> tuple[DPoPKey, str, uuid.UUID]:
    key = DPoPKey()
    resp = await register(client, key)
    return key, resp.json()["access_token"], await only_user_id(db)


async def test_download_allowed(client: httpx.AsyncClient, mongo: Collections):
    key, token, user_id = await _user(client, mongo)
    await grant(mongo, user_id)
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

    log = await one(mongo.download_logs)
    assert isinstance(log["_id"], uuid.UUID)
    assert log["userId"] == user_id
    assert log["productCode"] == "launcher_core"
    assert log["ipAddress"] == DEFAULT_IP
    assert log["userAgent"] == "NZT-Test/1.0"
    assert len(log["downloadTokenId"]) == 32
    assert log["createdAt"].tzinfo is not None


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
    mongo: Collections,
    is_enabled: bool,
    valid_until_delta: timedelta | None,
    expected: int,
):
    key, token, user_id = await _user(client, mongo)
    valid_until = datetime.now(UTC) + valid_until_delta if valid_until_delta else None
    await grant(mongo, user_id, is_enabled=is_enabled, valid_until=valid_until)
    resp = await download(client, key, token)
    assert resp.status_code == expected
    if expected == 403:
        assert resp.json() == {"detail": "User does not have active entitlement for launcher_core"}
        assert await mongo.download_logs.count_documents({}) == 0
    else:
        assert await mongo.download_logs.count_documents({}) == 1


async def test_entitlement_missing_or_other_product(client: httpx.AsyncClient, mongo: Collections):
    key, token, user_id = await _user(client, mongo)
    resp = await download(client, key, token)
    assert resp.status_code == 403
    assert resp.json() == {"detail": "User does not have active entitlement for launcher_core"}
    await grant(mongo, user_id, "nzt_suite")
    assert (await download(client, key, token)).status_code == 403


def test_require_entitlement_helper():
    now = datetime.now(UTC)
    user = AuthenticatedUser(
        id=uuid.uuid4(),
        email="e@d.com",
        jkt="x",
        role="customer",
        is_verified=True,
        entitlements=(
            Entitlement("nzt_suite", True, None),
            Entitlement("launcher_core", True, now - timedelta(seconds=1)),
            Entitlement("other", False, None),
        ),
    )
    assert has_active_entitlement(user, "nzt_suite", now)
    assert not has_active_entitlement(user, "launcher_core", now)  # expired
    assert not has_active_entitlement(user, "other", now)  # disabled
    assert not has_active_entitlement(user, "missing", now)


async def test_revoked_entitlement_takes_effect_on_next_request(
    client: httpx.AsyncClient, mongo: Collections
):
    key, token, user_id = await _user(client, mongo)
    await grant(mongo, user_id)
    assert (await download(client, key, token)).status_code == 200
    await mongo.users.update_one({"_id": user_id}, {"$set": {"entitlements.$[].isEnabled": False}})
    assert (await download(client, key, token)).status_code == 403


async def test_audit_rows_survive_user_deletion(client: httpx.AsyncClient, mongo: Collections):
    key, token, user_id = await _user(client, mongo)
    await grant(mongo, user_id)
    assert (await download(client, key, token)).status_code == 200
    await mongo.users.delete_one({"_id": user_id})
    log = await one(mongo.download_logs)  # audit trail is independent from the user
    assert log["productCode"] == "launcher_core"


def test_catalog_is_server_side_only(settings):  # type: ignore[no-untyped-def]
    catalog = artifact_catalog(settings)
    assert set(catalog) == {Product.LAUNCHER_CORE}
    art = catalog[Product.LAUNCHER_CORE]
    assert art.object_key == "binaries/launcher/v1.0.0/NZT-Launcher.exe"

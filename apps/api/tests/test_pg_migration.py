"""One-shot PostgreSQL -> MongoDB data migration (scripts/migrate_postgres_to_mongo.py):
the transformation of PostgreSQL rows, validated by the REAL collection validators, and
the idempotency of the write. Remove together with the script after the cut-over."""

from __future__ import annotations

import ipaddress
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from scripts.migrate_postgres_to_mongo import Snapshot, build_documents, verify, write_documents

from app.db import Collections
from app.security.passwords import PasswordService
from tests.conftest import download, login
from tests.helpers import STRONG_PASSWORD, DPoPKey

NOW = datetime(2026, 11, 18, 12, 0, 0, 123456, tzinfo=UTC)


def _snapshot(password_hash: str) -> tuple[Snapshot, uuid.UUID, uuid.UUID]:
    local, google = uuid.uuid4(), uuid.uuid4()
    base = {"created_at": NOW, "updated_at": NOW, "is_active": True}
    snap = Snapshot(
        users=[
            {**base, "id": local, "email": "local@domain.com", "password_hash": password_hash,
             "is_verified": False, "role": "customer"},
            {**base, "id": google, "email": "g@gmail.com", "password_hash": None,
             "is_verified": True, "role": "admin"},
        ],
        identities=[
            {"user_id": local, "provider": "local", "provider_user_id": "local@domain.com",
             "created_at": NOW},
            {"user_id": google, "provider": "google", "provider_user_id": "g-sub",
             "created_at": NOW},
        ],
        entitlements=[
            {"user_id": local, "product_code": "launcher_core", "is_enabled": True,
             "valid_until": None, "created_at": NOW},
        ],
        email_tokens=[
            {"token_hash": "a" * 64, "user_id": local, "used_at": None,
             "expires_at": NOW + timedelta(hours=1), "created_at": NOW},
            {"token_hash": "b" * 64, "user_id": local, "used_at": NOW,  # used: dropped
             "expires_at": NOW + timedelta(hours=1), "created_at": NOW},
            {"token_hash": "c" * 64, "user_id": local, "used_at": None,  # expired: dropped
             "expires_at": NOW - timedelta(seconds=1), "created_at": NOW},
        ],
        download_logs=[
            {"id": uuid.uuid4(), "user_id": local, "product_code": "launcher_core",
             "ip_address": ipaddress.ip_address("2001:db8::1"), "user_agent": None,
             "download_token_id": "d" * 32, "created_at": NOW},
            {"id": uuid.uuid4(), "user_id": None, "product_code": "launcher_core",
             "ip_address": ipaddress.ip_address("203.0.113.5"), "user_agent": "UA",
             "download_token_id": "e" * 32, "created_at": NOW},
        ],
    )  # fmt: skip
    return snap, local, google


def test_build_documents_shape():
    snap, local, google = _snapshot("$argon2id$x")
    docs = build_documents(snap, now=NOW)
    by_id = {u["_id"]: u for u in docs.users}
    assert by_id[local]["identities"][0]["providerUserId"] == "local@domain.com"
    assert by_id[local]["entitlements"][0]["productCode"] == "launcher_core"
    assert by_id[local]["createdAt"].microsecond == 123000  # BSON millisecond precision
    assert by_id[google]["role"] == "admin"
    assert by_id[google]["passwordHash"] is None
    assert [t["_id"] for t in docs.email_tokens] == ["a" * 64]
    assert [d["ipAddress"] for d in docs.download_logs] == ["2001:db8::1", "203.0.113.5"]


async def test_migrated_documents_pass_validators_and_work(
    client: httpx.AsyncClient, mongo: Collections
):
    pw_hash = await PasswordService(max_concurrency=1).hash(STRONG_PASSWORD)
    snap, _local, _ = _snapshot(pw_hash)
    docs = build_documents(snap, now=datetime.now(UTC) - timedelta(minutes=1))
    await write_documents(mongo, docs)
    await write_documents(mongo, docs)  # idempotent re-run
    assert await verify(mongo, docs) == []
    assert await mongo.users.count_documents({}) == 2
    assert await mongo.download_logs.count_documents({}) == 2
    # The migrated customer signs in again and keeps the entitlement.
    key = DPoPKey()
    resp = await login(client, key, email="local@domain.com")
    assert resp.status_code == 200, resp.text
    assert (await download(client, key, resp.json()["access_token"])).status_code == 200

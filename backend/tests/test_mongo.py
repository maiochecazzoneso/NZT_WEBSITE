"""MongoDB layer (spec §2-3 on MongoDB): schema step, validators, uniqueness, the runtime
user's least privilege, NoSQL-injection resistance, index usage of the hot queries."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from pymongo.errors import DuplicateKeyError, OperationFailure, WriteError

from app.db import Collections, identity_document, identity_filter, utcnow
from app.schema import SPECS, apply_schema, schema_drift
from tests.conftest import APP_URI, MONGO_DB, create_user, login, make_settings, register
from tests.helpers import DPoPKey

ROOT = Path(__file__).resolve().parents[1]
_UNAUTHORIZED = 13


def _db(mongo: Collections) -> Any:
    return mongo.users.database


# --- schema step ------------------------------------------------------------------------
async def test_schema_is_idempotent_and_in_sync(mongo: Collections):
    db = _db(mongo)
    await apply_schema(db)
    await apply_schema(db)
    assert await schema_drift(db) == []
    assert set(await db.list_collection_names()) >= {spec.name for spec in SPECS}


async def test_schema_drift_is_detected_and_repaired(mongo: Collections):
    db = _db(mongo)
    await db.command({"collMod": "users", "validator": {}, "validationLevel": "off"})
    await mongo.families.drop_index("user")
    drift = await schema_drift(db)
    assert "users: validator differs" in drift
    assert "users: validation is not strict/error" in drift
    assert "refreshTokenFamilies: index user differs" in drift
    await apply_schema(db)
    assert await schema_drift(db) == []


# --- validators (the old NOT NULL / CHECK / VARCHAR constraints) -----------------------
def _user(**over: Any) -> dict[str, Any]:
    now = utcnow()
    doc: dict[str, Any] = {
        "_id": uuid.uuid4(),
        "email": f"{uuid.uuid4().hex[:8]}@x.com",
        "passwordHash": None,
        "isActive": True,
        "isVerified": False,
        "role": "customer",
        "identities": [],
        "entitlements": [],
        "createdAt": now,
        "updatedAt": now,
    }
    doc.update(over)
    return doc


@pytest.mark.parametrize(
    "bad",
    [
        {"role": "root"},  # CHECK role IN ('customer', 'admin')
        {"email": "x" * 256},  # VARCHAR(255)
        {"isActive": "yes"},
        {"_id": "not-a-uuid"},
        {"$where": "1"},  # unknown field
        {"identities": [{"provider": "github", "providerUserId": "1", "createdAt": utcnow()}]},
        {"entitlements": [{"productCode": "x", "isEnabled": True}]},  # missing fields
    ],
)
async def test_users_validator_rejects(mongo: Collections, bad: dict[str, Any]):
    with pytest.raises(WriteError):
        await mongo.users.insert_one(_user(**bad))


async def test_users_validator_requires_every_field(mongo: Collections):
    for field in ("email", "passwordHash", "isActive", "role", "createdAt"):
        doc = _user()
        del doc[field]
        with pytest.raises(WriteError):
            await mongo.users.insert_one(doc)
    doc = _user()
    await mongo.users.insert_one(doc)
    with pytest.raises(WriteError):  # updates are validated too
        await mongo.users.update_one({"_id": doc["_id"]}, {"$set": {"role": "superuser"}})


async def test_unique_canonical_email(mongo: Collections, client: httpx.AsyncClient):
    await create_user(mongo, "a@x.com")
    with pytest.raises(DuplicateKeyError):
        await create_user(mongo, "a@x.com")
    # Every API path canonicalises (lower-case) before storing/matching.
    assert (await register(client, DPoPKey(), email="A@X.com")).status_code == 400


async def test_lookalike_addresses_are_distinct_accounts(client_factory: Any, mongo: Collections):
    """Exact match on the canonical email (no ICU collation): a full-width alias is NOT
    the victim's account (review finding: collation strength 2 equated them)."""
    assert await register(client_factory("198.51.100.1"), DPoPKey(), email="victim@corp.com")
    alias = "\uff56ictim@corp.com"  # full-width "v"
    resp = await login(client_factory("198.51.100.2"), DPoPKey(), email=alias)
    assert resp.status_code == 401
    assert await mongo.users.count_documents({"email": "victim@corp.com"}) == 1


async def test_changed_index_definition_is_rebuilt(mongo: Collections):
    db = _db(mongo)
    await mongo.users.drop_index("email_unique")
    await mongo.users.create_index("email", name="email_unique")  # not unique any more
    assert "users: index email_unique differs" in await schema_drift(db)
    await apply_schema(db)
    assert await schema_drift(db) == []


async def test_retired_index_is_dropped(mongo: Collections):
    """A database prepared by an earlier schema version (collation email index) is fixed
    by apply_schema."""
    from pymongo.collation import Collation

    db = _db(mongo)
    await mongo.users.create_index(
        "email", name="email_ci_unique", unique=True, collation=Collation("en", strength=2)
    )
    assert "users: index email_ci_unique differs" in await schema_drift(db)
    await apply_schema(db)
    assert await schema_drift(db) == []


async def test_external_identity_belongs_to_one_user(mongo: Collections):
    now = utcnow()
    await mongo.users.insert_one(_user(identities=[identity_document("google", "g-1", now)]))
    with pytest.raises(DuplicateKeyError):
        await mongo.users.insert_one(_user(identities=[identity_document("google", "g-1", now)]))
    # Same subject string with another provider, and users without identities: no clash.
    await mongo.users.insert_one(_user(identities=[identity_document("local", "g-1", now)]))
    await mongo.users.insert_one(_user())
    await mongo.users.insert_one(_user())


async def test_database_payloads_never_logged(
    client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
):
    with caplog.at_level(logging.DEBUG):
        assert (await register(client, DPoPKey(), email="secret.user@domain.com")).status_code
    assert "secret.user@domain.com" not in caplog.text
    assert "$argon2id$" not in caplog.text
    assert "passwordHash" not in caplog.text


# --- least privilege (spec §2 rule 2) --------------------------------------------------
async def test_app_user_is_dml_only_on_its_database():
    from app.db import create_client

    client = create_client(make_settings(), uri=APP_URI)
    try:
        db = client[MONGO_DB]
        status = await db.command("connectionStatus")
        roles = status["authInfo"]["authenticatedUserRoles"]
        assert roles == [{"role": "nztApp", "db": MONGO_DB}]
        forbidden = [
            lambda: db.users.create_index("evil"),
            lambda: db.users.drop_index("email_unique"),
            lambda: db.users.drop(),
            lambda: db.command({"collMod": "users", "validator": {}}),
            lambda: db.create_collection("evil"),
            lambda: db.command("dropDatabase"),
            lambda: db.command("createUser", "evil", pwd="x", roles=[]),
            lambda: db.users.aggregate([{"$out": "evil"}]),
            lambda: client["admin"]["system.users"].find_one(),
            lambda: client["other_service"]["data"].find_one(),
            lambda: client["other_service"]["data"].insert_one({"a": 1}),
        ]
        for attempt in forbidden:
            with pytest.raises(OperationFailure) as exc:
                await attempt()
            assert exc.value.code == _UNAUTHORIZED
        # DML is allowed.
        doc = _user(email="dml@x.com")
        await db.users.insert_one(doc)
        assert await db.users.count_documents({}) == 1
        await db.users.update_one({"_id": doc["_id"]}, {"$set": {"isVerified": True}})
        await db.users.delete_one({"_id": doc["_id"]})
    finally:
        await client.close()


async def test_schema_user_is_not_cluster_admin(mongo: Collections):
    status = await _db(mongo).command("connectionStatus")
    roles = {(r["role"], r["db"]) for r in status["authInfo"]["authenticatedUserRoles"]}
    assert roles == {("dbAdmin", MONGO_DB), ("readWrite", MONGO_DB)}
    with pytest.raises(OperationFailure):
        await mongo.users.database.client["other_service"]["data"].find_one()


# --- NoSQL operator injection (security architecture §3.2, scenario B) -----------------
@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/v1/auth/login", {"email": {"$ne": None}, "password": "x"}),
        ("/api/v1/auth/login", {"email": "a@b.com", "password": {"$gt": ""}}),
        ("/api/v1/auth/register", {"email": {"$gt": ""}, "password": "SuperSecure123!x"}),
        ("/api/v1/auth/verify-email", {"token": {"$ne": None}}),
        ("/api/v1/auth/verify-email", {"token": "x", "$where": "1"}),
    ],
)
async def test_operator_payloads_are_rejected_before_the_database(
    client: httpx.AsyncClient, mongo: Collections, path: str, body: dict[str, Any]
):
    await create_user(mongo, "victim@domain.com")
    resp = await client.post(path, json=body, headers={"DPoP": DPoPKey().proof("POST", path)})
    assert resp.status_code == 422
    assert "$" not in resp.text or "$ne" not in resp.text  # input is never echoed back


_SERVER_SIDE_JS = re.compile(r"\$(where|function|accumulator)\b|map_reduce|mapReduce")


def test_no_server_side_javascript_in_queries():
    offenders = [
        f"{path.relative_to(ROOT)}:{n}"
        for path in sorted((ROOT / "src").rglob("*.py"))
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if _SERVER_SIDE_JS.search(line)
    ]
    assert offenders == []


# --- index usage of the hot queries (no collection scans) ------------------------------
def _stages(plan: dict[str, Any]) -> set[str]:
    out = {plan.get("stage", "")}
    for key in ("inputStage", "queryPlan"):
        if key in plan:
            out |= _stages(plan[key])
    for child in plan.get("inputStages", []):
        out |= _stages(child)
    return out


async def test_hot_queries_use_indexes(client: httpx.AsyncClient, mongo: Collections):
    await register(client, DPoPKey())
    user_id = (await mongo.users.find_one({}))["_id"]  # type: ignore[index]
    queries = [
        (mongo.users.find({"email": "user@domain.com"}), "email"),
        (mongo.users.find(identity_filter("google", "sub")), "google identity"),
        (mongo.users.find({"_id": user_id, "isActive": True}), "authentication"),
        (mongo.families.find({"userId": user_id, "isRevoked": False}), "revoke all"),
        (mongo.families.find({"_id": uuid.uuid4(), "currentTokenHash": "a" * 64}), "rotate"),
        (mongo.refresh_tokens.find({"_id": "a" * 64}), "token lookup"),
        (mongo.email_tokens.find({"userId": user_id, "usedAt": None}), "pending tokens"),
        (mongo.email_tokens.find({"_id": "a" * 64, "usedAt": None}), "verify"),
    ]
    for cursor, what in queries:
        plan = (await cursor.explain())["queryPlanner"]["winningPlan"]
        assert "COLLSCAN" not in _stages(plan), (what, plan)

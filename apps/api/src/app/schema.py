"""MongoDB schema: collection validators ($jsonSchema, strict) + indexes, applied by a
SEPARATE privileged user. Idempotent.

    python -m app.schema          # create collections / update validators / create indexes
    python -m app.schema --check  # exit 1 if the database differs from this file (CI)

The URI comes from NZT_MONGODB_MIGRATIONS_URI (user with dbAdmin + readWrite on the API
database). It is required in production: the API service itself never holds it, its own
user can only find/insert/update/remove (scripts/db/create_roles.py).

Validators enforce inside the database the shape of every document (types, required
fields, enums, lengths, no unknown fields), like NOT NULL / CHECK constraints would.
TTL indexes delete expired refresh tokens / families / verification tokens."""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.config import Settings, get_settings
from app.db import (
    DOWNLOAD_LOGS,
    EMAIL_COLLATION,
    EMAIL_VERIFICATION_TOKENS,
    PROVIDER_GOOGLE,
    PROVIDER_LOCAL,
    REFRESH_TOKEN_FAMILIES,
    REFRESH_TOKENS,
    ROLE_ADMIN,
    ROLE_CUSTOMER,
    USERS,
    Document,
    create_client,
)

_SHA256_HEX = {"bsonType": "string", "pattern": "^[0-9a-f]{64}$"}
_UUID = {"bsonType": "binData"}
_DATE = {"bsonType": "date"}
_BOOL = {"bsonType": "bool"}


def _string(max_length: int, min_length: int = 1) -> dict[str, Any]:
    return {"bsonType": "string", "minLength": min_length, "maxLength": max_length}


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    out = dict(schema)
    out["bsonType"] = [schema["bsonType"], "null"]
    return out


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    """Every listed property is required and nothing else is allowed."""
    return {
        "bsonType": "object",
        "required": list(properties),
        "additionalProperties": False,
        "properties": properties,
    }


def _validator(properties: dict[str, Any]) -> Document:
    return {"$jsonSchema": _object(properties)}


@dataclass(frozen=True)
class CollectionSpec:
    name: str
    validator: Document
    indexes: list[IndexModel] = field(default_factory=list)


SPECS: tuple[CollectionSpec, ...] = (
    CollectionSpec(
        USERS,
        _validator(
            {
                "_id": _UUID,
                "email": _string(255, 3),
                "passwordHash": _nullable(_string(255)),
                "isActive": _BOOL,
                "isVerified": _BOOL,
                "role": {"enum": [ROLE_CUSTOMER, ROLE_ADMIN]},
                "identities": {
                    "bsonType": "array",
                    "items": _object(
                        {
                            "provider": {"enum": [PROVIDER_LOCAL, PROVIDER_GOOGLE]},
                            "providerUserId": _string(255),
                            "createdAt": _DATE,
                        }
                    ),
                },
                "entitlements": {
                    "bsonType": "array",
                    "items": _object(
                        {
                            "productCode": _string(64),
                            "isEnabled": _BOOL,
                            "validUntil": _nullable(_DATE),
                            "createdAt": _DATE,
                        }
                    ),
                },
                "createdAt": _DATE,
                "updatedAt": _DATE,
            }
        ),
        [
            IndexModel(
                [("email", ASCENDING)],
                name="email_ci_unique",
                unique=True,
                collation=EMAIL_COLLATION,
            ),
            # One external identity (provider, subject) belongs to at most one user.
            IndexModel(
                [("identities.provider", ASCENDING), ("identities.providerUserId", ASCENDING)],
                name="identities_unique",
                unique=True,
                partialFilterExpression={"identities.providerUserId": {"$exists": True}},
            ),
        ],
    ),
    CollectionSpec(
        REFRESH_TOKEN_FAMILIES,
        _validator(
            {
                "_id": _UUID,
                "userId": _UUID,
                "dpopJkt": _string(255),
                "isRevoked": _BOOL,
                "revokedReason": _nullable(_string(100)),
                "currentTokenHash": _SHA256_HEX,
                "expiresAt": _DATE,
                "createdAt": _DATE,
                "updatedAt": _DATE,
            }
        ),
        [
            IndexModel([("currentTokenHash", ASCENDING)], name="current_token_unique", unique=True),
            IndexModel([("userId", ASCENDING)], name="user"),
            IndexModel([("expiresAt", ASCENDING)], name="expires_ttl", expireAfterSeconds=0),
        ],
    ),
    CollectionSpec(
        REFRESH_TOKENS,
        # _id = sha256(token) hex: every token ever issued -> its family (reuse detection).
        _validator({"_id": _SHA256_HEX, "familyId": _UUID, "expiresAt": _DATE, "createdAt": _DATE}),
        [IndexModel([("expiresAt", ASCENDING)], name="expires_ttl", expireAfterSeconds=0)],
    ),
    CollectionSpec(
        EMAIL_VERIFICATION_TOKENS,
        _validator(
            {
                "_id": _SHA256_HEX,
                "userId": _UUID,
                "expiresAt": _DATE,
                "usedAt": _nullable(_DATE),
                "createdAt": _DATE,
            }
        ),
        [
            IndexModel([("userId", ASCENDING)], name="user"),
            IndexModel([("expiresAt", ASCENDING)], name="expires_ttl", expireAfterSeconds=0),
        ],
    ),
    CollectionSpec(
        DOWNLOAD_LOGS,
        # Audit trail: no TTL. userId stays when a user is deleted (D-A3: rows survive).
        _validator(
            {
                "_id": _UUID,
                "userId": _nullable(_UUID),
                "productCode": _string(64),
                "ipAddress": _string(45, 2),
                "userAgent": _nullable(_string(512, 0)),
                "downloadTokenId": _string(64),
                "createdAt": _DATE,
            }
        ),
        [IndexModel([("userId", ASCENDING), ("createdAt", DESCENDING)], name="user_audit")],
    ),
)

_UNAUTHORIZED = 13
_COMPARED_INDEX_OPTIONS = ("unique", "expireAfterSeconds", "partialFilterExpression")


def _index_signature(doc: Mapping[str, Any]) -> dict[str, Any]:
    sig: dict[str, Any] = {"key": list(dict(doc["key"]).items())}
    for option in _COMPARED_INDEX_OPTIONS:
        if doc.get(option) is not None:
            sig[option] = doc[option]
    collation = doc.get("collation")
    if collation:
        sig["collation"] = {"locale": collation["locale"], "strength": collation["strength"]}
    return sig


async def apply_schema(db: AsyncDatabase[Document]) -> None:
    existing = set(await db.list_collection_names())
    for spec in SPECS:
        if spec.name in existing:
            await db.command(
                {
                    "collMod": spec.name,
                    "validator": spec.validator,
                    "validationLevel": "strict",
                    "validationAction": "error",
                }
            )
        else:
            await db.create_collection(
                spec.name,
                validator=spec.validator,
                validationLevel="strict",
                validationAction="error",
            )
        if spec.indexes:
            await db[spec.name].create_indexes(spec.indexes)


async def schema_drift(db: AsyncDatabase[Document]) -> list[str]:
    """Differences between the database and SPECS (empty list = in sync)."""
    problems: list[str] = []
    infos = {c["name"]: c async for c in await db.list_collections()}
    for spec in SPECS:
        info = infos.get(spec.name)
        if info is None:
            problems.append(f"{spec.name}: missing collection")
            continue
        opts = info.get("options", {})
        if opts.get("validator") != spec.validator:
            problems.append(f"{spec.name}: validator differs")
        if (opts.get("validationLevel"), opts.get("validationAction")) != ("strict", "error"):
            problems.append(f"{spec.name}: validation is not strict/error")
        actual = {
            d["name"]: _index_signature(d)
            async for d in await db[spec.name].list_indexes()
            if d["name"] != "_id_"
        }
        wanted = {m.document["name"]: _index_signature(m.document) for m in spec.indexes}
        for name in sorted(wanted.keys() | actual.keys()):
            if wanted.get(name) != actual.get(name):
                problems.append(f"{spec.name}: index {name} differs")
    return problems


def migrations_uri(settings: Settings) -> str:
    if settings.mongodb_migrations_uri is not None:
        return settings.mongodb_migrations_uri.get_secret_value()
    if settings.is_production:
        # The API service does not hold the schema user's credentials; the schema step
        # must receive them explicitly.
        raise RuntimeError(
            "NZT_MONGODB_MIGRATIONS_URI is required to apply the schema in production "
            "(user with dbAdmin on the API database); refusing to fall back to NZT_MONGODB_URI"
        )
    return settings.mongodb_uri.get_secret_value()


async def run(settings: Settings, *, check: bool) -> int:
    client = create_client(settings, uri=migrations_uri(settings))
    try:
        db = client[settings.mongodb_database]
        if not check:
            await apply_schema(db)
        problems = await schema_drift(db)
    except OperationFailure as exc:
        if exc.code != _UNAUTHORIZED:
            raise
        print(
            "schema: the configured user may not manage the schema (expected for the API "
            "user): set NZT_MONGODB_MIGRATIONS_URI to the schema user (dbAdmin)",
            file=sys.stderr,
        )
        return 2
    finally:
        await client.close()
    for problem in problems:
        print(f"schema: {problem}", file=sys.stderr)
    if not problems:
        print(f"schema: {settings.mongodb_database} is up to date")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.schema")
    parser.add_argument("--check", action="store_true", help="only report drift")
    args = parser.parse_args(argv)
    return asyncio.run(run(get_settings(), check=args.check))


if __name__ == "__main__":
    sys.exit(main())

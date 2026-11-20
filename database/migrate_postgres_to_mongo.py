"""ONE-SHOT data migration PostgreSQL -> MongoDB (Area Clienti). Delete this file after the
cut-over: nothing else uses it and asyncpg is not an API dependency any more.

    # from the repo root (runs with the backend's Python environment)
    NZT_PG_SOURCE_DSN='postgresql://nzt_app:...@host:5432/nzt' \\
    NZT_MONGODB_MIGRATIONS_URI='mongodb+srv://nzt_migrator:...@cluster/?authSource=admin' \\
    NZT_MONGODB_DATABASE=nzt \\
    uv run --project backend --with asyncpg python database/migrate_postgres_to_mongo.py [--dry-run]

* Source: read in ONE read-only REPEATABLE READ transaction (consistent snapshot); a
  read-only role is enough (nzt_app). Target: the schema user (dbAdmin + readWrite);
  the schema (validators + indexes) is applied first, so every document is validated.
* Migrated: users (+ identities and entitlements embedded), PENDING non-expired email
  verification tokens, download logs (audit). Same UUIDs as PostgreSQL.
* NOT migrated: refresh-token families/tokens. Every user signs in once more and gets a
  fresh DPoP-bound session (safer than carrying sessions across systems).
* Idempotent: upserts by _id, so it can be re-run (e.g. after a dry run or a failure).
* TLS is required unless --insecure-local (local test services only)."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import SecretStr
from pymongo import ReplaceOne

from app.config import Settings
from app.db import Collections, Document, create_client
from app.schema import apply_schema

Row = dict[str, Any]
BATCH = 500


@dataclass
class Snapshot:
    users: list[Row] = field(default_factory=list)
    identities: list[Row] = field(default_factory=list)
    entitlements: list[Row] = field(default_factory=list)
    email_tokens: list[Row] = field(default_factory=list)
    download_logs: list[Row] = field(default_factory=list)
    skipped_sessions: int = 0


@dataclass
class Documents:
    users: list[Document]
    email_tokens: list[Document]
    download_logs: list[Document]


def _ms(value: datetime | None) -> datetime | None:
    """PostgreSQL has microseconds, BSON dates milliseconds."""
    if value is None:
        return None
    value = value.astimezone(UTC)
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def build_documents(snap: Snapshot, *, now: datetime | None = None) -> Documents:
    now = now or datetime.now(UTC)
    identities: dict[uuid.UUID, list[Document]] = defaultdict(list)
    for r in sorted(snap.identities, key=lambda r: r["created_at"]):
        identities[r["user_id"]].append(
            {
                "provider": r["provider"],
                "providerUserId": r["provider_user_id"],
                "createdAt": _ms(r["created_at"]),
            }
        )
    entitlements: dict[uuid.UUID, list[Document]] = defaultdict(list)
    for r in sorted(snap.entitlements, key=lambda r: r["created_at"]):
        entitlements[r["user_id"]].append(
            {
                "productCode": r["product_code"],
                "isEnabled": r["is_enabled"],
                "validUntil": _ms(r["valid_until"]),
                "createdAt": _ms(r["created_at"]),
            }
        )
    users = [
        {
            "_id": r["id"],
            "email": r["email"].strip().lower(),
            "passwordHash": r["password_hash"],
            "isActive": r["is_active"],
            "isVerified": r["is_verified"],
            "role": r.get("role") or "customer",
            "identities": identities.get(r["id"], []),
            "entitlements": entitlements.get(r["id"], []),
            "createdAt": _ms(r["created_at"]),
            "updatedAt": _ms(r["updated_at"]),
        }
        for r in snap.users
    ]
    email_tokens = [
        {
            "_id": r["token_hash"],
            "userId": r["user_id"],
            "expiresAt": _ms(r["expires_at"]),
            "usedAt": None,
            "createdAt": _ms(r["created_at"]),
        }
        for r in snap.email_tokens
        if r["used_at"] is None and r["expires_at"] > now
    ]
    download_logs = [
        {
            "_id": r["id"],
            "userId": r["user_id"],
            "productCode": r["product_code"],
            "ipAddress": str(r["ip_address"]),
            "userAgent": r["user_agent"],
            "downloadTokenId": r["download_token_id"],
            "createdAt": _ms(r["created_at"]),
        }
        for r in snap.download_logs
    ]
    return Documents(users=users, email_tokens=email_tokens, download_logs=download_logs)


async def load_snapshot(dsn: str) -> Snapshot:  # pragma: no cover - needs PostgreSQL
    import asyncpg  # only for this one-shot run: uv run --with asyncpg ...

    conn = await asyncpg.connect(dsn)
    try:
        async with conn.transaction(readonly=True, isolation="repeatable_read"):
            snap = Snapshot()
            snap.users = [dict(r) for r in await conn.fetch("SELECT * FROM users")]
            snap.identities = [dict(r) for r in await conn.fetch("SELECT * FROM auth_identities")]
            snap.entitlements = [dict(r) for r in await conn.fetch("SELECT * FROM entitlements")]
            snap.email_tokens = [
                dict(r) for r in await conn.fetch("SELECT * FROM email_verification_tokens")
            ]
            snap.download_logs = [dict(r) for r in await conn.fetch("SELECT * FROM download_logs")]
            snap.skipped_sessions = await conn.fetchval(
                "SELECT count(*) FROM refresh_token_families WHERE NOT is_revoked"
            )
    finally:
        await conn.close()
    return snap


async def write_documents(db: Collections, docs: Documents) -> None:
    for collection, items in (
        (db.users, docs.users),
        (db.email_tokens, docs.email_tokens),
        (db.download_logs, docs.download_logs),
    ):
        for start in range(0, len(items), BATCH):
            batch = items[start : start + BATCH]
            await collection.bulk_write(
                [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in batch], ordered=True
            )


async def verify(db: Collections, docs: Documents) -> list[str]:
    problems = []
    for name, collection, items in (
        ("users", db.users, docs.users),
        ("emailVerificationTokens", db.email_tokens, docs.email_tokens),
        ("downloadLogs", db.download_logs, docs.download_logs),
    ):
        ids = [d["_id"] for d in items]
        found = await collection.count_documents({"_id": {"$in": ids}}) if ids else 0
        if found != len(ids):
            problems.append(f"{name}: {found}/{len(ids)} documents found")
    return problems


async def run(
    *, source_dsn: str, target_uri: str, database: str, dry_run: bool, tls: bool
) -> int:  # pragma: no cover - exercised manually against PostgreSQL
    snap = await load_snapshot(source_dsn)
    docs = build_documents(snap)
    print(
        f"source: {len(snap.users)} users, {len(snap.identities)} identities, "
        f"{len(snap.entitlements)} entitlements, {len(docs.email_tokens)} pending "
        f"verification tokens, {len(snap.download_logs)} download logs; "
        f"{snap.skipped_sessions} active sessions NOT migrated (users sign in again)"
    )
    if dry_run:
        print("dry run: nothing written")
        return 0
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        mongodb_uri=SecretStr(target_uri),
        mongodb_database=database,
        mongodb_tls=tls,
    )
    client = create_client(settings)
    try:
        mdb = client[database]
        await apply_schema(mdb)
        db = Collections.of(mdb)
        await write_documents(db, docs)
        problems = await verify(db, docs)
    finally:
        await client.close()
    for problem in problems:
        print(f"ERROR {problem}", file=sys.stderr)
    if not problems:
        print(f"done: {database} contains every migrated document")
    return 1 if problems else 0


def main() -> int:  # pragma: no cover
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--insecure-local", action="store_true", help="no TLS (local only)")
    args = parser.parse_args()
    env = {
        name: os.environ.get(name, "")
        for name in ("NZT_PG_SOURCE_DSN", "NZT_MONGODB_MIGRATIONS_URI", "NZT_MONGODB_DATABASE")
    }
    missing = [name for name, value in env.items() if not value and not args.dry_run]
    if not env["NZT_PG_SOURCE_DSN"] or missing:
        raise SystemExit(f"required: {', '.join(missing or ['NZT_PG_SOURCE_DSN'])}")
    return asyncio.run(
        run(
            source_dsn=env["NZT_PG_SOURCE_DSN"],
            target_uri=env["NZT_MONGODB_MIGRATIONS_URI"],
            database=env["NZT_MONGODB_DATABASE"],
            dry_run=args.dry_run,
            tls=not args.insecure_local,
        )
    )


if __name__ == "__main__":
    sys.exit(main())

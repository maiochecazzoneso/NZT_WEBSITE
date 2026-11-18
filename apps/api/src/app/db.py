"""MongoDB access through PyMongo's native asyncio API (``AsyncMongoClient``).

One client (= one connection pool) per process. Every collection name lives here, so the
API, the schema step (``app/schema.py``), the seed and the data migration all agree.

Security (spec §2, security architecture §3.2 scenario B):
* filters are built ONLY from typed server-side values (``uuid.UUID``, hashes computed by
  the server, Pydantic-validated ``str``, ``bool``, ``datetime``); a request body or a
  client-supplied ``dict`` never becomes a filter or an update => no operator injection
  (``{"$ne": null}``, ``{"$gt": ""}``, server-side JavaScript...);
* the runtime user only has find/insert/update/remove on the API collections of ONE
  database (``scripts/db/create_roles.py``); validators and indexes are applied by a
  separate user;
* production: TLS with certificate and hostname verification (``config.py`` guards);
* writes are acknowledged by the majority of the replica set (durable audit rows)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.collation import Collation

from app.config import Settings

# PyMongo's DEBUG command log prints whole documents (emails, password and token hashes).
# Pinned to WARNING whatever NZT_LOG_LEVEL is: database payloads never reach the logs.
logging.getLogger("pymongo").setLevel(logging.WARNING)

Document = dict[str, Any]
Client = AsyncMongoClient[Document]
Collection = AsyncCollection[Document]

USERS = "users"
REFRESH_TOKEN_FAMILIES = "refreshTokenFamilies"  # noqa: S105 (a collection name)
REFRESH_TOKENS = "refreshTokens"
EMAIL_VERIFICATION_TOKENS = "emailVerificationTokens"
DOWNLOAD_LOGS = "downloadLogs"

# Collation of the unique email index (case-insensitive, like the old lower(email) index).
# Every lookup by email passes it so that the index is used and the match is exact.
EMAIL_COLLATION = Collation(locale="en", strength=2)

ROLE_CUSTOMER = "customer"
ROLE_ADMIN = "admin"
PROVIDER_LOCAL = "local"
PROVIDER_GOOGLE = "google"


def utcnow() -> datetime:
    """Aware UTC now truncated to milliseconds (BSON dates have ms resolution, so values
    written and read back compare equal)."""
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def create_client(settings: Settings, *, uri: str | None = None) -> Client:
    options: dict[str, Any] = {
        "appname": "nzt-area-api",
        "uuidRepresentation": "standard",  # uuid.UUID <-> BSON binary subtype 4
        "tz_aware": True,  # dates come back as aware UTC datetimes
        "w": "majority",
        "readPreference": "primary",
        "retryWrites": True,
        "retryReads": True,
        "maxPoolSize": settings.mongodb_max_pool_size,
        "timeoutMS": settings.mongodb_timeout_ms,
        "serverSelectionTimeoutMS": settings.mongodb_server_selection_timeout_ms,
    }
    if settings.effective_mongodb_tls:
        # Certificate AND hostname verification stay ON (pymongo defaults); the guards in
        # config.py refuse URI options that would weaken them in production.
        options["tls"] = True
        if settings.mongodb_tls_ca_file:
            options["tlsCAFile"] = settings.mongodb_tls_ca_file
    return AsyncMongoClient(uri or settings.mongodb_uri.get_secret_value(), **options)


@dataclass(frozen=True, slots=True)
class Collections:
    users: Collection
    families: Collection
    refresh_tokens: Collection
    email_tokens: Collection
    download_logs: Collection

    @classmethod
    def of(cls, db: AsyncDatabase[Document]) -> Collections:
        return cls(
            users=db[USERS],
            families=db[REFRESH_TOKEN_FAMILIES],
            refresh_tokens=db[REFRESH_TOKENS],
            email_tokens=db[EMAIL_VERIFICATION_TOKENS],
            download_logs=db[DOWNLOAD_LOGS],
        )


def identity_filter(provider: str, provider_user_id: str) -> Document:
    """Filter "the user owning this external identity". The ``$exists`` term lets the
    planner match the PARTIAL unique index ``identities_unique`` (an $elemMatch alone
    does not imply its filter and would scan the whole collection)."""
    return {
        "identities": {"$elemMatch": {"provider": provider, "providerUserId": provider_user_id}},
        "identities.providerUserId": {"$exists": True},
    }


def identity_document(provider: str, provider_user_id: str, now: datetime) -> Document:
    return {"provider": provider, "providerUserId": provider_user_id, "createdAt": now}


def user_document(
    *,
    email: str,
    password_hash: str | None,
    is_verified: bool,
    identities: list[Document],
    now: datetime,
    role: str = ROLE_CUSTOMER,
    user_id: uuid.UUID | None = None,
) -> Document:
    """A new ``users`` document (shape enforced by the collection validator)."""
    return {
        "_id": user_id or uuid.uuid4(),
        "email": email,
        "passwordHash": password_hash,
        "isActive": True,
        "isVerified": is_verified,
        "role": role,
        "identities": identities,
        "entitlements": [],
        "createdAt": now,
        "updatedAt": now,
    }

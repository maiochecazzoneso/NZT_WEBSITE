"""NZT Area Clienti - least-privilege MongoDB users (spec §2 rule 2). Idempotent.

Lives in database/ but runs with the backend's Python environment (it imports the
collection list from app.schema). Run ONCE per database with an administrator connection
(self-hosted MongoDB, local test services, docker compose). On MongoDB Atlas users and
custom roles are managed from the Atlas UI/API instead: create the same role and users
there (database/README.md, docs/architettura_sicurezza_area_clienti.md §24.2).

    NZT_MONGODB_ROOT_URI='mongodb://root:...@host:27017/?authSource=admin' \\
    NZT_DB_NAME=nzt NZT_MIGRATOR_PASSWORD='...' NZT_APP_PASSWORD='...' \\
    uv run --project backend python database/create_roles.py      # from the repo root

Result (users are created in the API database, so authSource=<db name>):
  nzt_migrator : dbAdmin + readWrite on <db> -> python -m app.schema, data migration
  nzt_app      : role nztApp = ONLY find/insert/update/remove on the API collections
                 (app/schema.py SPECS), listed one by one: no createIndex, collMod, drop,
                 no new collections (not even implicitly through insert or $out), no
                 access to other databases (a shared cluster can host other services).
Re-run it after adding a collection to SPECS.

Uses only pymongo (no mongosh needed); passwords never appear on the command line."""

from __future__ import annotations

import os
import re
import sys
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import OperationFailure

from app.schema import (
    DOWNLOAD_LOGS,
    EMAIL_VERIFICATION_TOKENS,
    REFRESH_TOKEN_FAMILIES,
    REFRESH_TOKENS,
    SPECS,
    USERS,
)

APP_ROLE = "nztApp"
# Per-collection least privilege: downloadLogs is append-only (insert only).
COLLECTION_ACTIONS: dict[str, list[str]] = {
    USERS: ["find", "insert", "update"],
    REFRESH_TOKEN_FAMILIES: ["find", "insert", "update"],
    REFRESH_TOKENS: ["find", "insert", "remove"],
    EMAIL_VERIFICATION_TOKENS: ["find", "insert", "update", "remove"],
    DOWNLOAD_LOGS: ["insert"],
}
DEFAULT_ACTIONS = ["find", "insert", "update", "remove"]
MIGRATOR_USER = "nzt_migrator"
APP_USER = "nzt_app"
_DB_NAME = re.compile(r"^[A-Za-z0-9_-]{1,38}$")
_USER_NOT_FOUND = 11
_ROLE_NOT_FOUND = 31


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        raise SystemExit(f"create_roles: {name} is required")
    return value


def ensure_role(db: Database[Any], privileges: list[dict[str, Any]]) -> None:
    try:
        db.command("updateRole", APP_ROLE, privileges=privileges, roles=[])
    except OperationFailure as exc:
        if exc.code != _ROLE_NOT_FOUND:
            raise
        db.command("createRole", APP_ROLE, privileges=privileges, roles=[])


def ensure_user(db: Database[Any], name: str, password: str, roles: list[dict[str, str]]) -> None:
    try:
        db.command("updateUser", name, pwd=password, roles=roles)
    except OperationFailure as exc:
        if exc.code != _USER_NOT_FOUND:
            raise
        db.command("createUser", name, pwd=password, roles=roles)


def main() -> int:
    db_name = _env("NZT_DB_NAME", "nzt")
    if not _DB_NAME.fullmatch(db_name):
        raise SystemExit("create_roles: NZT_DB_NAME must match [A-Za-z0-9_-]{1,38}")
    migrator_password = _env("NZT_MIGRATOR_PASSWORD")
    app_password = _env("NZT_APP_PASSWORD")
    with MongoClient(_env("NZT_MONGODB_ROOT_URI"), serverSelectionTimeoutMS=10_000) as client:
        db = client[db_name]
        ensure_role(
            db,
            [
                {
                    "resource": {"db": db_name, "collection": spec.name},
                    "actions": COLLECTION_ACTIONS.get(spec.name, DEFAULT_ACTIONS),
                }
                for spec in SPECS
            ],
        )
        ensure_user(
            db,
            MIGRATOR_USER,
            migrator_password,
            [{"role": "dbAdmin", "db": db_name}, {"role": "readWrite", "db": db_name}],
        )
        ensure_user(db, APP_USER, app_password, [{"role": APP_ROLE, "db": db_name}])
    print(f"create_roles: {db_name}: role {APP_ROLE}, users {MIGRATOR_USER}, {APP_USER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

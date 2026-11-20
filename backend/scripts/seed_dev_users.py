"""Utenti di PROVA (solo stack locale):

* ``admin@example.com`` / ``admin``     -> role 'admin': entra nella dashboard amministratore.
* ``cliente@example.com`` / ``cliente`` -> role 'customer': entra nel portale clienti normale.

Le email devono essere valide (il login le valida), quindi "admin" da solo non è accettato.
Entrambi sono verificati e attivi; il cliente ha il diritto di download su tutti i prodotti.
Idempotente: a ogni esecuzione reimposta password e ruolo.

Guardie: rifiuta di girare con NZT_ENVIRONMENT=production e richiede NZT_SEED_DEV_USERS=true
(impostato solo nel docker-compose.yml di prova). Mai in produzione: le password sono banali.
"""

import asyncio
import os
import sys
import uuid

from app.config import Settings
from app.db import (
    PROVIDER_LOCAL,
    ROLE_CUSTOMER,
    Collections,
    create_client,
    identity_document,
    utcnow,
)
from app.security.passwords import PasswordService
from app.services.storage import Product

# (email, password, role)
USERS = (
    ("admin@example.com", os.environ.get("NZT_SEED_ADMIN_PASSWORD") or "admin", "admin"),
    ("cliente@example.com", os.environ.get("NZT_SEED_CLIENT_PASSWORD") or "cliente", "customer"),
)


async def upsert_user(
    db: Collections, passwords: PasswordService, email: str, password: str, role: str
) -> None:
    now = utcnow()
    entitlements = (
        [
            {"productCode": p.value, "isEnabled": True, "validUntil": None, "createdAt": now}
            for p in Product
        ]
        if role == ROLE_CUSTOMER
        else []
    )
    await db.users.update_one(
        {"email": email},
        {
            "$set": {
                "passwordHash": await passwords.hash(password),
                "isActive": True,
                "isVerified": True,
                "role": role,
                "identities": [identity_document(PROVIDER_LOCAL, email, now)],
                "entitlements": entitlements,
                "updatedAt": now,
            },
            "$setOnInsert": {"_id": uuid.uuid4(), "email": email, "createdAt": now},
        },
        upsert=True,
    )


async def main() -> int:
    settings = Settings()
    if settings.is_production or os.environ.get("NZT_SEED_DEV_USERS") != "true":
        msg = "seed_dev_users: rifiutato (produzione o NZT_SEED_DEV_USERS != true)"
        print(msg, file=sys.stderr)
        return 1

    passwords = PasswordService(max_concurrency=1)
    client = create_client(settings)
    try:
        db = Collections.of(client[settings.mongodb_database])
        for email, password, role in USERS:
            await upsert_user(db, passwords, email, password, role)
    finally:
        await client.close()
    for email, _password, role in USERS:
        print(f"seed_dev_users: {role:8} {email}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

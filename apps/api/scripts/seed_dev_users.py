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

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import create_engine, create_sessionmaker
from app.models import Entitlement, User
from app.security.passwords import PasswordService
from app.services.storage import Product

# (email, password, role)
USERS = (
    ("admin@example.com", os.environ.get("NZT_SEED_ADMIN_PASSWORD") or "admin", "admin"),
    ("cliente@example.com", os.environ.get("NZT_SEED_CLIENT_PASSWORD") or "cliente", "customer"),
)


async def upsert_user(
    session: AsyncSession, passwords: PasswordService, email: str, password: str, role: str
) -> uuid.UUID:
    password_hash = await passwords.hash(password)
    user = (
        await session.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()
    if user is None:
        user = User(id=uuid.uuid4(), email=email)
        session.add(user)
    user.password_hash = password_hash
    user.is_active = True
    user.is_verified = True
    user.role = role
    await session.flush()
    return user.id


async def main() -> int:
    settings = Settings()
    if settings.is_production or os.environ.get("NZT_SEED_DEV_USERS") != "true":
        msg = "seed_dev_users: rifiutato (produzione o NZT_SEED_DEV_USERS != true)"
        print(msg, file=sys.stderr)
        return 1

    passwords = PasswordService(max_concurrency=1)
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            for email, password, role in USERS:
                user_id = await upsert_user(session, passwords, email, password, role)
                if role != "customer":
                    continue
                for product in Product:
                    await session.execute(
                        insert(Entitlement)
                        .values(
                            id=uuid.uuid4(),
                            user_id=user_id,
                            product_code=product.value,
                            is_enabled=True,
                            valid_until=None,
                        )
                        .on_conflict_do_update(
                            index_elements=["user_id", "product_code"],
                            set_={"is_enabled": True, "valid_until": None},
                        )
                    )
    finally:
        await engine.dispose()
    for email, _password, role in USERS:
        print(f"seed_dev_users: {role:8} {email}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

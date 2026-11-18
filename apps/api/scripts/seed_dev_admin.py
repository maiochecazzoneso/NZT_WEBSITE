"""Account di PROVA admin@example.com / admin (solo stack locale).

L'email deve essere un indirizzo valido (il login la valida), quindi "admin" da solo non è
accettato: lo username è ``admin@example.com``. L'account è verificato, attivo e con diritto di
download su tutti i prodotti. Idempotente: a ogni esecuzione reimposta la password.

Guardie: rifiuta di girare con NZT_ENVIRONMENT=production e richiede NZT_SEED_DEV_ADMIN=true
(impostato solo nel docker-compose.yml di prova). Mai in produzione: la password è banale.
"""

import asyncio
import os
import sys
import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.config import Settings
from app.db import create_engine, create_sessionmaker
from app.models import Entitlement, User
from app.security.passwords import PasswordService
from app.services.storage import Product

EMAIL = "admin@example.com"
PASSWORD = "admin"  # noqa: S105 - account di prova, vedi docstring


async def main() -> int:
    settings = Settings()
    if settings.is_production or os.environ.get("NZT_SEED_DEV_ADMIN") != "true":
        msg = "seed_dev_admin: rifiutato (produzione o NZT_SEED_DEV_ADMIN != true)"
        print(msg, file=sys.stderr)
        return 1

    password_hash = await PasswordService(max_concurrency=1).hash(PASSWORD)
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            user_id = await session.scalar(select(User.id).where(func.lower(User.email) == EMAIL))
            if user_id is None:
                user_id = uuid.uuid4()
                session.add(
                    User(
                        id=user_id,
                        email=EMAIL,
                        password_hash=password_hash,
                        is_active=True,
                        is_verified=True,
                    )
                )
                await session.flush()
            else:
                user = await session.get(User, user_id)
                assert user is not None
                user.password_hash = password_hash
                user.is_active = True
                user.is_verified = True
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
    print(f"seed_dev_admin: pronto -> {EMAIL} / {PASSWORD}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

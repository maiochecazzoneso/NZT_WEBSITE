"""Async Alembic environment. Uses the MIGRATOR role (NZT_MIGRATIONS_DATABASE_URL),
never the runtime app role. An explicit URL can be injected via
``config.attributes["database_url"]`` (tests)."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection

from app.config import Settings
from app.db import create_engine
from app.models import Base

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logging", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _migration_url(settings: Settings) -> str:
    explicit = config.attributes.get("database_url")
    if isinstance(explicit, str):
        return explicit
    if settings.migrations_database_url is not None:
        return settings.migrations_database_url.get_secret_value()
    if settings.is_production:
        # The API service does not hold the migrator credentials; migrations run in a
        # separate pipeline step that must provide them explicitly.
        raise RuntimeError(
            "NZT_MIGRATIONS_DATABASE_URL is required to run migrations in production "
            "(migrator role with DDL rights); refusing to fall back to NZT_DATABASE_URL"
        )
    return settings.database_url.get_secret_value()


def run_migrations_offline() -> None:
    settings = Settings()
    context.configure(
        url=_migration_url(settings),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    settings = Settings()
    engine = create_engine(settings, url=_migration_url(settings))
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

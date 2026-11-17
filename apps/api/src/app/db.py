"""Async SQLAlchemy engine/session factory (asyncpg => server-side prepared statements)."""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator
from typing import Any

from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, SslMode


def normalize_db_url(raw: str) -> str:
    """Force the asyncpg driver and drop libpq-only query args (sslmode is passed
    separately as an ``ssl`` connect arg)."""
    url = make_url(raw)
    if url.drivername in {"postgres", "postgresql", "postgresql+psycopg2", "postgresql+psycopg"}:
        url = url.set(drivername="postgresql+asyncpg")
    if url.drivername != "postgresql+asyncpg":
        raise ValueError("only PostgreSQL (asyncpg) URLs are supported")
    query = {k: v for k, v in url.query.items() if k not in {"sslmode", "ssl", "sslrootcert"}}
    return url.set(query=query).render_as_string(hide_password=False)


def build_ssl_arg(mode: SslMode, root_cert: str | None) -> ssl.SSLContext | bool:
    if mode == "disable":
        return False
    ctx = ssl.create_default_context(cafile=root_cert)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    if mode == "require":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    elif mode == "verify-ca":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def create_engine(settings: Settings, *, url: str | None = None) -> AsyncEngine:
    connect_args: dict[str, Any] = {
        "ssl": build_ssl_arg(settings.effective_db_sslmode, settings.database_ssl_root_cert),
        "server_settings": {"application_name": "nzt-area-api"},
    }
    return create_async_engine(
        normalize_db_url(url or settings.database_url.get_secret_value()),
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    maker: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker
    async with maker() as session:
        yield session

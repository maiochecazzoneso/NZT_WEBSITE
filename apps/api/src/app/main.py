"""FastAPI application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.client_ip import ClientIPResolver
from app.config import Settings, get_settings
from app.db import create_engine, create_sessionmaker
from app.deps import Services
from app.errors import install_error_handlers
from app.middleware import (
    BodySizeLimitMiddleware,
    SecurityHeadersMiddleware,
    ServerErrorGuardMiddleware,
)
from app.ratelimit import RateLimiter
from app.routers import auth, downloads, google, health
from app.security.dpop import DPoPValidator
from app.security.passwords import PasswordService
from app.security.sealed import Sealer
from app.security.tokens import AccessTokenService, load_signing_key
from app.services.google import GoogleOIDCClient
from app.services.sessions import SessionService
from app.services.storage import Presigner

logger = logging.getLogger("app")


def build_services(
    settings: Settings, *, http_transport: httpx.AsyncBaseTransport | None = None
) -> Services:
    engine = create_engine(settings)
    redis = Redis.from_url(
        settings.redis_url.get_secret_value(),
        decode_responses=True,
        socket_timeout=2.0,
        socket_connect_timeout=2.0,
    )
    http = httpx.AsyncClient(
        transport=http_transport,
        follow_redirects=False,
        timeout=settings.google_http_timeout_seconds,
        headers={"User-Agent": "nzt-area-api"},
    )
    tokens = AccessTokenService(
        load_signing_key(settings),
        issuer=settings.api_public_base_url,
        ttl_seconds=settings.access_token_ttl_seconds,
    )
    return Services(
        settings=settings,
        engine=engine,
        sessionmaker=create_sessionmaker(engine),
        redis=redis,
        http=http,
        passwords=PasswordService(
            settings.argon2_max_concurrency, max_queue=settings.argon2_max_queue
        ),
        tokens=tokens,
        dpop=DPoPValidator(
            redis=redis,
            public_base_url=settings.api_public_base_url,
            iat_leeway=settings.dpop_iat_leeway_seconds,
        ),
        sessions=SessionService(
            tokens=tokens, redis=redis, refresh_ttl_seconds=settings.refresh_token_ttl_seconds
        ),
        rate_limiter=RateLimiter(redis),
        client_ip=ClientIPResolver(settings.trusted_proxy_cidrs),
        sealer=Sealer.from_settings(settings),
        google=GoogleOIDCClient(settings, http),
        presigner=Presigner(settings),
    )


def create_app(
    settings: Settings | None = None,
    *,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services = build_services(settings, http_transport=http_transport)
        app.state.services = services
        app.state.sessionmaker = services.sessionmaker
        try:
            yield
        finally:
            await services.http.aclose()
            await services.redis.aclose()
            await services.engine.dispose()

    docs_enabled = not settings.is_production
    app = FastAPI(
        title="NZT Solutions - Area Clienti API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
        swagger_ui_oauth2_redirect_url=None,
    )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(google.router)
    app.include_router(downloads.router)

    # Order: last added = outermost. Outer -> inner:
    #   SecurityHeaders -> CORS -> ServerErrorGuard -> BodySizeLimit -> app
    # Security headers wrap everything (incl. CORS preflights and 413/500 responses), and
    # CORS now wraps the 413 (body limit) and the generic 500 too, so an allowed portal
    # origin can read every error status. Retry-After is exposed so the portal can show
    # the real wait time on 429/503 (review I6).
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(ServerErrorGuardMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.portal_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "DPoP"],
        expose_headers=["Retry-After"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
    return app

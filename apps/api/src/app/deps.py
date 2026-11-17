"""Shared FastAPI dependencies: service container, DPoP proof extraction, DPoP-bound
access-token authentication, entitlements (spec §7, phase 5)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Header, HTTPException, Request
from redis.asyncio import Redis
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.sql import func

from app.client_ip import ClientIPResolver
from app.config import Settings
from app.db import get_session
from app.errors import www_authenticate_dpop
from app.models import Entitlement, User
from app.ratelimit import RateLimiter
from app.security.dpop import DPoPError, DPoPProof, DPoPValidator
from app.security.passwords import PasswordService
from app.security.sealed import Sealer
from app.security.tokens import AccessTokenError, AccessTokenService
from app.services.google import GoogleOIDCClient
from app.services.sessions import SessionService
from app.services.storage import Presigner


@dataclass(slots=True)
class Services:
    settings: Settings
    engine: AsyncEngine
    sessionmaker: async_sessionmaker[AsyncSession]
    redis: Redis
    http: httpx.AsyncClient
    passwords: PasswordService
    tokens: AccessTokenService
    dpop: DPoPValidator
    sessions: SessionService
    rate_limiter: RateLimiter
    client_ip: ClientIPResolver
    sealer: Sealer
    google: GoogleOIDCClient
    presigner: Presigner


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


ServicesDep = Annotated[Services, Depends(get_services)]
DbSession = Annotated[AsyncSession, Depends(get_session)]
DPoPHeader = Annotated[
    str | None,
    Header(alias="DPoP", description="DPoP proof JWT (RFC 9449), ES256 / P-256 key"),
]


def dpop_unauthorized(description: str, error: str = "invalid_dpop_proof") -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Invalid DPoP proof" if error == "invalid_dpop_proof" else "Invalid access token",
        headers={"WWW-Authenticate": www_authenticate_dpop(error, description)},
    )


async def require_dpop_proof(
    request: Request, services: ServicesDep, dpop: DPoPHeader = None
) -> DPoPProof:
    """Proof for token endpoints (register/login/refresh/logout/google callback): no ath."""
    try:
        return await services.dpop.validate(dpop, method=request.method, path=request.url.path)
    except DPoPError as exc:
        raise dpop_unauthorized(exc.description) from exc


DPoPProofDep = Annotated[DPoPProof, Depends(require_dpop_proof)]


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: uuid.UUID
    email: str
    jkt: str


async def get_current_user(
    request: Request,
    services: ServicesDep,
    db: DbSession,
    dpop: DPoPHeader = None,
    authorization: Annotated[str | None, Header(description="DPoP <access_token>")] = None,
) -> AuthenticatedUser:
    """Protected resource auth (spec §6 step 4, RFC 9449 §7): Authorization: DPoP <AT>
    + proof with ath; cnf.jkt must equal the proof key thumbprint."""
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": www_authenticate_dpop()},
        )
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "dpop" or not token:
        raise dpop_unauthorized("Authorization scheme must be DPoP", error="invalid_token")
    try:
        claims = services.tokens.verify(token)
    except AccessTokenError as exc:
        raise dpop_unauthorized(exc.description, error="invalid_token") from exc
    try:
        proof = await services.dpop.validate(
            dpop, method=request.method, path=request.url.path, access_token=token
        )
    except DPoPError as exc:
        raise dpop_unauthorized(exc.description) from exc
    if proof.jkt != claims.jkt:
        raise dpop_unauthorized("DPoP key does not match token binding", error="invalid_token")
    if await services.sessions.is_access_token_revoked(
        user_id=claims.sub, jkt=claims.jkt, iat=claims.iat, iat_ms=claims.iat_ms
    ):
        raise dpop_unauthorized("token revoked", error="invalid_token")
    result = await db.execute(
        select(User.id, User.email).where(User.id == claims.sub, User.is_active.is_(True))
    )
    row = result.one_or_none()
    if row is None:
        raise dpop_unauthorized("unknown or inactive user", error="invalid_token")
    return AuthenticatedUser(id=row.id, email=row.email, jkt=claims.jkt)


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]


async def has_active_entitlement(db: AsyncSession, user_id: uuid.UUID, product_code: str) -> bool:
    result = await db.execute(
        select(Entitlement.id).where(
            Entitlement.user_id == user_id,
            Entitlement.product_code == product_code,
            Entitlement.is_enabled.is_(True),
            or_(Entitlement.valid_until.is_(None), Entitlement.valid_until > func.now()),
        )
    )
    return result.scalar_one_or_none() is not None


def require_entitlement(
    product_code: str,
) -> Callable[[AuthenticatedUser, AsyncSession], Awaitable[AuthenticatedUser]]:
    """Dependency factory (spec §10 phase 5): 403 unless an enabled, non-expired
    entitlement for ``product_code`` exists."""

    async def dependency(user: CurrentUser, db: DbSession) -> AuthenticatedUser:
        if not await has_active_entitlement(db, user.id, product_code):
            raise HTTPException(
                status_code=403,
                detail=f"User does not have active entitlement for {product_code}",
            )
        return user

    return dependency

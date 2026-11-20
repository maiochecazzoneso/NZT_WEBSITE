"""Shared FastAPI dependencies: service container, DPoP proof extraction, DPoP-bound
access-token authentication, admin role, entitlements (spec §7, phase 5).

The authenticated user's document (active flag, role, verification state, entitlements)
is read from MongoDB ONCE per request, inside the authentication itself: a disabled user,
a demoted admin or a revoked entitlement takes effect on the very next request, and the
admin / entitlement / ``/me`` checks need no further query."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

import httpx
from fastapi import Depends, Header, HTTPException, Request
from redis.asyncio import Redis

from app.client_ip import ClientIPResolver
from app.config import Settings
from app.db import NOT_TAKEOVER_PENDING, ROLE_ADMIN, Client, Collections, utcnow
from app.errors import www_authenticate_dpop
from app.ratelimit import RateLimiter
from app.security.dpop import DPoPError, DPoPProof, DPoPValidator
from app.security.passwords import PasswordService
from app.security.sealed import Sealer
from app.security.tokens import AccessTokenError, AccessTokenService
from app.services.google import GoogleOIDCClient
from app.services.mailer import Mailer
from app.services.sessions import SessionService
from app.services.storage import Presigner


@dataclass(slots=True)
class Services:
    settings: Settings
    mongo: Client
    db: Collections
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
    mailer: Mailer


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


ServicesDep = Annotated[Services, Depends(get_services)]
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
class Entitlement:
    product_code: str
    is_enabled: bool
    valid_until: datetime | None

    def is_active(self, now: datetime) -> bool:
        return self.is_enabled and (self.valid_until is None or self.valid_until > now)


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: uuid.UUID
    email: str
    jkt: str
    role: str
    aud: str
    is_verified: bool
    entitlements: tuple[Entitlement, ...] = ()


_USER_PROJECTION = {"email": 1, "role": 1, "isVerified": 1, "entitlements": 1}


def _entitlements(raw: Any) -> tuple[Entitlement, ...]:
    return tuple(
        Entitlement(e["productCode"], e["isEnabled"], e.get("validUntil")) for e in raw or ()
    )


async def get_current_user(
    request: Request,
    services: ServicesDep,
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
    doc = await services.db.users.find_one(
        {"_id": claims.sub, "isActive": True, **NOT_TAKEOVER_PENDING}, _USER_PROJECTION
    )
    if doc is None:
        raise dpop_unauthorized("unknown or inactive user", error="invalid_token")
    return AuthenticatedUser(
        id=doc["_id"],
        email=doc["email"],
        jkt=claims.jkt,
        role=doc["role"],
        aud=claims.aud,
        is_verified=doc["isVerified"],
        entitlements=_entitlements(doc.get("entitlements")),
    )


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]


def has_active_entitlement(
    user: AuthenticatedUser, product_code: str, now: datetime | None = None
) -> bool:
    now = now or utcnow()
    return any(e.product_code == product_code and e.is_active(now) for e in user.entitlements)


def require_entitlement(
    product_code: str,
) -> Callable[[AuthenticatedUser], Awaitable[AuthenticatedUser]]:
    """Dependency factory (spec §10 phase 5): 403 unless an enabled, non-expired
    entitlement for ``product_code`` exists."""

    async def dependency(user: CurrentUser) -> AuthenticatedUser:
        if not has_active_entitlement(user, product_code):
            raise HTTPException(
                status_code=403,
                detail=f"User does not have active entitlement for {product_code}",
            )
        return user

    return dependency


async def get_current_admin(user: CurrentUser) -> AuthenticatedUser:
    """Admin-only resources: valid DPoP-bound admin-realm token AND role == 'admin' read
    from the database on every request (a demoted/disabled admin loses access immediately)."""
    if user.role != ROLE_ADMIN or user.aud != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


CurrentAdmin = Annotated[AuthenticatedUser, Depends(get_current_admin)]

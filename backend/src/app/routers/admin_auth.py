"""Admin dashboard authentication (separate from customers: own endpoints, own refresh
cookie/path). Same machinery (Argon2id, DPoP-bound tokens, RTR sessions); only users with
role 'admin' can log in or refresh here. Magic-link login is planned as a later step."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Cookie, Depends, Request
from fastapi.responses import JSONResponse, Response
from starlette.responses import Response as StarletteResponse

from app.cookies import (
    ADMIN_REFRESH_COOKIE,
    clear_admin_refresh_cookie,
    set_admin_refresh_cookie,
)
from app.db import ROLE_ADMIN
from app.deps import CurrentAdmin, DPoPProofDep, ServicesDep, dpop_unauthorized
from app.errors import www_authenticate_dpop
from app.ratelimit import (
    LOGIN_PER_EMAIL,
    LOGIN_PER_IP,
    LOGOUT_PER_IP,
    REFRESH_PER_FAMILY,
    REFRESH_PER_IP,
)
from app.routers.auth import password_login
from app.schemas import ErrorResponse, LoginRequest, TokenResponse
from app.security.tokens import REALM_ADMIN
from app.services.sessions import IssuedSession, RefreshError, RefreshOutcome, TokenRef

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin-auth"])

INVALID_CREDENTIALS = "Invalid email or password"

AdminRefreshCookie = Annotated[
    str | None, Cookie(alias=ADMIN_REFRESH_COOKIE, description="Opaque admin refresh token")
]

_429: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorResponse, "description": "Rate limited (Retry-After)"},
    503: {"model": ErrorResponse, "description": "Busy / dependency down (Retry-After)"},
}


def _token_response(issued: IssuedSession, *, refresh_ttl: int) -> JSONResponse:
    body = TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)
    response = JSONResponse(status_code=200, content=body.model_dump())
    set_admin_refresh_cookie(response, issued.refresh_token, refresh_ttl)
    return response


def _error(
    status_code: int, detail: str, *, clear_refresh: bool = False, dpop_error: str | None = None
) -> JSONResponse:
    headers = {"WWW-Authenticate": www_authenticate_dpop(dpop_error)} if dpop_error else None
    response = JSONResponse(status_code=status_code, content={"detail": detail}, headers=headers)
    if clear_refresh:
        clear_admin_refresh_cookie(response)
    return response


async def _rl_login_ip(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(
        LOGIN_PER_IP, "admin:" + services.client_ip.for_rate_limit(request)
    )


async def _rl_refresh_ip(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(
        REFRESH_PER_IP, "admin:" + services.client_ip.for_rate_limit(request)
    )


async def _rl_logout(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(
        LOGOUT_PER_IP, "admin:" + services.client_ip.for_rate_limit(request)
    )


async def presented_admin_refresh_token(
    services: ServicesDep,
    _: Annotated[None, Depends(_rl_refresh_ip)],
    refresh: AdminRefreshCookie = None,
) -> TokenRef | None:
    """Looked up once per request: FastAPI caches it for the rate limit AND the handler.
    _rl_refresh_ip runs first so rate-limited IPs cannot hit MongoDB."""
    return await services.sessions.lookup(refresh)


AdminRefreshTokenRef = Annotated[TokenRef | None, Depends(presented_admin_refresh_token)]


async def _rl_refresh(request: Request, services: ServicesDep, ref: AdminRefreshTokenRef) -> None:
    identifier = (
        f"family:{ref.family_id}"
        if ref is not None
        else f"admin-anon:{services.client_ip.for_rate_limit(request)}"
    )
    await services.rate_limiter.hit(REFRESH_PER_FAMILY, identifier)


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse, "description": INVALID_CREDENTIALS}, **_429},
    dependencies=[Depends(_rl_login_ip)],
)
async def admin_login(
    services: ServicesDep,
    proof: DPoPProofDep,
    payload: Annotated[LoginRequest, Body()],
) -> JSONResponse:
    # Share LOGIN_PER_EMAIL with customer login so admin passwords don't get 2x brute-force budget.
    await services.rate_limiter.hit(LOGIN_PER_EMAIL, payload.email)
    # Same Argon2id work and same message for "not an admin" as for "wrong password".
    issued = await password_login(services, payload, jkt=proof.jkt, admin=True)
    if issued is None:
        return _error(401, INVALID_CREDENTIALS)
    logger.info("admin login ok")
    return _token_response(issued, refresh_ttl=services.settings.refresh_token_ttl_seconds)


@router.post(
    "/auth/refresh",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse, "description": "Invalid refresh"}, **_429},
    dependencies=[Depends(_rl_refresh)],
)
async def admin_refresh(
    services: ServicesDep,
    proof: DPoPProofDep,
    ref: AdminRefreshTokenRef,
    refresh_token: AdminRefreshCookie = None,
) -> JSONResponse:
    if not refresh_token:
        return _error(401, "Missing refresh token")
    try:
        # The role is re-checked inside the rotation: a demoted admin cannot keep renewing
        # the admin session (that session is revoked).
        issued = await services.sessions.rotate(
            ref, jkt=proof.jkt, realm=REALM_ADMIN, required_role=ROLE_ADMIN
        )
    except RefreshError as exc:
        if exc.outcome is RefreshOutcome.REUSE:
            logger.warning("SECURITY: admin refresh token reuse detected; all sessions revoked")
            return _error(401, "Refresh token reuse detected", clear_refresh=True)
        if exc.outcome is RefreshOutcome.KEY_MISMATCH:
            return _error(
                401,
                "DPoP key does not match refresh token binding",
                dpop_error="invalid_dpop_proof",
            )
        return _error(401, "Invalid refresh token", clear_refresh=True)
    return _token_response(issued, refresh_ttl=services.settings.refresh_token_ttl_seconds)


@router.post(
    "/auth/logout",
    status_code=204,
    response_class=Response,
    responses={
        401: {"model": ErrorResponse, "description": "Missing cookie / key mismatch"},
        **_429,
    },
    dependencies=[Depends(_rl_logout)],
)
async def admin_logout(
    services: ServicesDep,
    proof: DPoPProofDep,
    ref: AdminRefreshTokenRef,
    refresh_token: AdminRefreshCookie = None,
) -> StarletteResponse:
    if not refresh_token:
        return _error(401, "Missing refresh token")
    if not await services.sessions.logout(ref, jkt=proof.jkt, realm=REALM_ADMIN):
        raise dpop_unauthorized("DPoP key does not match refresh token binding")
    response = Response(status_code=204)
    clear_admin_refresh_cookie(response)
    return response


@router.get("/me")
async def admin_me(admin: CurrentAdmin) -> dict[str, str]:
    return {"email": admin.email}

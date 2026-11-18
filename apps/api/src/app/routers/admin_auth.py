"""Admin dashboard authentication (separate from customers: own endpoints, own refresh
cookie/path). Same machinery (Argon2id, DPoP-bound tokens, RTR sessions); only users with
role 'admin' can log in or refresh here. Magic-link login is planned as a later step."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Cookie, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, select, update
from starlette.responses import Response as StarletteResponse

from app.cookies import (
    ADMIN_REFRESH_COOKIE,
    clear_admin_refresh_cookie,
    set_admin_refresh_cookie,
)
from app.deps import CurrentAdmin, DbSession, DPoPProofDep, ServicesDep, dpop_unauthorized
from app.errors import www_authenticate_dpop
from app.models import RefreshTokenFamily, User
from app.ratelimit import LOGIN_PER_EMAIL, LOGIN_PER_IP, REFRESH_PER_FAMILY
from app.schemas import ErrorResponse, LoginRequest, TokenResponse
from app.security.passwords import PasswordHasherBusyError
from app.services.sessions import IssuedSession, RefreshError, RefreshOutcome

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
        LOGIN_PER_IP, "admin:" + services.client_ip.for_request(request)
    )


async def _rl_refresh(
    request: Request, services: ServicesDep, db: DbSession, refresh: AdminRefreshCookie = None
) -> None:
    family_id = await services.sessions.family_id_for(db, refresh)
    await db.rollback()
    identifier = (
        f"family:{family_id}"
        if family_id is not None
        else f"admin-anon:{services.client_ip.for_request(request)}"
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
    db: DbSession,
    proof: DPoPProofDep,
    payload: Annotated[LoginRequest, Body()],
) -> JSONResponse:
    await services.rate_limiter.hit(LOGIN_PER_EMAIL, "admin:" + payload.email)
    result = await db.execute(
        select(User.id, User.password_hash, User.is_active, User.role).where(
            func.lower(User.email) == payload.email
        )
    )
    row = result.one_or_none()
    if row is None or row.password_hash is None or not row.is_active or row.role != "admin":
        # Same Argon2id work and same message for "not an admin" as for "wrong password".
        await services.passwords.dummy_verify(payload.password)
        return _error(401, INVALID_CREDENTIALS)
    if not await services.passwords.verify(row.password_hash, payload.password):
        return _error(401, INVALID_CREDENTIALS)
    if services.passwords.hasher.check_needs_rehash(row.password_hash):
        try:
            new_hash = await services.passwords.hash(payload.password)
        except PasswordHasherBusyError:
            new_hash = None
        if new_hash is not None:
            await db.execute(update(User).where(User.id == row.id).values(password_hash=new_hash))
    issued = await services.sessions.create_session(db, user_id=row.id, jkt=proof.jkt)
    await db.commit()
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
    db: DbSession,
    proof: DPoPProofDep,
    refresh_token: AdminRefreshCookie = None,
) -> JSONResponse:
    if not refresh_token:
        return _error(401, "Missing refresh token")
    try:
        issued = await services.sessions.rotate(db, raw=refresh_token, jkt=proof.jkt)
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
    # Role is re-checked: a demoted admin cannot keep renewing the admin session.
    role = await db.scalar(
        select(User.role)
        .join(RefreshTokenFamily, RefreshTokenFamily.user_id == User.id)
        .where(RefreshTokenFamily.id == issued.family_id)
    )
    if role != "admin":
        return _error(401, "Invalid refresh token", clear_refresh=True)
    return _token_response(issued, refresh_ttl=services.settings.refresh_token_ttl_seconds)


@router.post(
    "/auth/logout",
    status_code=204,
    response_class=Response,
    responses={401: {"model": ErrorResponse, "description": "Missing cookie / key mismatch"}},
)
async def admin_logout(
    services: ServicesDep,
    db: DbSession,
    proof: DPoPProofDep,
    refresh_token: AdminRefreshCookie = None,
) -> StarletteResponse:
    if not refresh_token:
        return _error(401, "Missing refresh token")
    if not await services.sessions.logout(db, raw=refresh_token, jkt=proof.jkt):
        raise dpop_unauthorized("DPoP key does not match refresh token binding")
    response = Response(status_code=204)
    clear_admin_refresh_cookie(response)
    return response


@router.get("/me")
async def admin_me(admin: CurrentAdmin) -> dict[str, str]:
    return {"email": admin.email}

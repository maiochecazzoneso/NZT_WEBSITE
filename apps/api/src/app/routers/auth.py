"""Local authentication endpoints: register, login, refresh, logout (spec §8.1-8.3, D-A7)."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Body, Cookie, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.cookies import REFRESH_COOKIE, clear_refresh_cookie, set_refresh_cookie
from app.deps import DbSession, DPoPProofDep, ServicesDep, dpop_unauthorized
from app.errors import www_authenticate_dpop
from app.models import AuthIdentity, User
from app.ratelimit import LOGIN_PER_EMAIL, LOGIN_PER_IP, REFRESH_PER_FAMILY, REGISTER_PER_IP
from app.schemas import ErrorResponse, LoginRequest, RegisterRequest, TokenResponse
from app.security.passwords import PasswordHasherBusyError
from app.services.sessions import IssuedSession, RefreshError, RefreshOutcome

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

INVALID_CREDENTIALS = "Invalid email or password"
REGISTRATION_FAILED = "Registration failed"

RefreshCookie = Annotated[
    str | None, Cookie(alias=REFRESH_COOKIE, description="Opaque refresh token")
]

_DPOP_401: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Invalid/missing DPoP proof"}
}
_429: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorResponse, "description": "Rate limited (Retry-After)"},
    503: {"model": ErrorResponse, "description": "Busy / dependency down (Retry-After)"},
}


def token_response(issued: IssuedSession, *, status_code: int, refresh_ttl: int) -> JSONResponse:
    body = TokenResponse(access_token=issued.access_token, expires_in=issued.expires_in)
    response = JSONResponse(status_code=status_code, content=body.model_dump())
    set_refresh_cookie(response, issued.refresh_token, refresh_ttl)
    return response


def error_response(
    status_code: int, detail: str, *, clear_refresh: bool = False, dpop_error: str | None = None
) -> JSONResponse:
    headers = {"WWW-Authenticate": www_authenticate_dpop(dpop_error)} if dpop_error else None
    response = JSONResponse(status_code=status_code, content={"detail": detail}, headers=headers)
    if clear_refresh:
        clear_refresh_cookie(response)
    return response


# --- rate-limit dependencies (resolved BEFORE body validation / DPoP) ------------------
async def _rl_register(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(REGISTER_PER_IP, services.client_ip.for_request(request))


async def _rl_login_ip(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(LOGIN_PER_IP, services.client_ip.for_request(request))


async def _rl_refresh(
    request: Request, services: ServicesDep, db: DbSession, refresh: RefreshCookie = None
) -> None:
    family_id = await services.sessions.family_id_for(db, refresh)
    await db.rollback()
    identifier = (
        f"family:{family_id}"
        if family_id is not None
        else f"anon:{services.client_ip.for_request(request)}"
    )
    await services.rate_limiter.hit(REFRESH_PER_FAMILY, identifier)


@router.post(
    "/register",
    status_code=201,
    response_model=TokenResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Registration failed"},
        **_DPOP_401,
        **_429,
    },
    dependencies=[Depends(_rl_register)],
)
async def register(
    services: ServicesDep,
    db: DbSession,
    proof: DPoPProofDep,
    payload: Annotated[RegisterRequest, Body()],
) -> JSONResponse:
    password_hash = await services.passwords.hash(payload.password)
    user = User(id=uuid.uuid4(), email=payload.email, password_hash=password_hash)
    try:
        db.add(user)
        await db.flush()
        db.add(
            AuthIdentity(
                id=uuid.uuid4(), user_id=user.id, provider="local", provider_user_id=payload.email
            )
        )
        await db.flush()
    except IntegrityError:
        await db.rollback()
        # D-A12: generic failure, no "email already exists" message.
        return error_response(400, REGISTRATION_FAILED)
    issued = await services.sessions.create_session(db, user_id=user.id, jkt=proof.jkt)
    await db.commit()
    return token_response(
        issued, status_code=201, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse, "description": INVALID_CREDENTIALS}, **_429},
    dependencies=[Depends(_rl_login_ip)],
)
async def login(
    services: ServicesDep,
    db: DbSession,
    proof: DPoPProofDep,
    payload: Annotated[LoginRequest, Body()],
) -> JSONResponse:
    await services.rate_limiter.hit(LOGIN_PER_EMAIL, payload.email)
    result = await db.execute(
        select(User.id, User.password_hash, User.is_active).where(
            func.lower(User.email) == payload.email
        )
    )
    row = result.one_or_none()
    if row is None or row.password_hash is None or not row.is_active:
        # Spec §4.2: identical Argon2id work when the user cannot log in with a password.
        await services.passwords.dummy_verify(payload.password)
        return error_response(401, INVALID_CREDENTIALS)
    if not await services.passwords.verify(row.password_hash, payload.password):
        return error_response(401, INVALID_CREDENTIALS)
    if services.passwords.hasher.check_needs_rehash(row.password_hash):
        try:
            new_hash = await services.passwords.hash(payload.password)
        except PasswordHasherBusyError:
            new_hash = None  # best effort: rehash again on a later login
        if new_hash is not None:
            await db.execute(update(User).where(User.id == row.id).values(password_hash=new_hash))
    issued = await services.sessions.create_session(db, user_id=row.id, jkt=proof.jkt)
    await db.commit()
    return token_response(
        issued, status_code=200, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse, "description": "Invalid refresh"}, **_429},
    dependencies=[Depends(_rl_refresh)],
)
async def refresh(
    services: ServicesDep,
    db: DbSession,
    proof: DPoPProofDep,
    refresh_token: RefreshCookie = None,
) -> JSONResponse:
    if not refresh_token:
        return error_response(401, "Missing refresh token")
    try:
        issued = await services.sessions.rotate(db, raw=refresh_token, jkt=proof.jkt)
    except RefreshError as exc:
        if exc.outcome is RefreshOutcome.REUSE:
            logger.warning("SECURITY: refresh token reuse detected; all sessions revoked")
            return error_response(401, "Refresh token reuse detected", clear_refresh=True)
        if exc.outcome is RefreshOutcome.KEY_MISMATCH:
            return error_response(
                401,
                "DPoP key does not match refresh token binding",
                dpop_error="invalid_dpop_proof",
            )
        return error_response(401, "Invalid refresh token", clear_refresh=True)
    return token_response(
        issued, status_code=200, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )


@router.post(
    "/logout",
    status_code=204,
    response_class=Response,
    responses={401: {"model": ErrorResponse, "description": "Missing cookie / key mismatch"}},
)
async def logout(
    services: ServicesDep,
    db: DbSession,
    proof: DPoPProofDep,
    refresh_token: RefreshCookie = None,
) -> Response:
    if not refresh_token:
        return error_response(401, "Missing refresh token")
    if not await services.sessions.logout(db, raw=refresh_token, jkt=proof.jkt):
        raise dpop_unauthorized("DPoP key does not match refresh token binding")
    response = Response(status_code=204)
    clear_refresh_cookie(response)
    return response

"""Local authentication endpoints: register, login, refresh, logout (spec §8.1-8.3, D-A7)."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Cookie, Depends, Request
from fastapi.responses import JSONResponse, Response
from pymongo.errors import DuplicateKeyError
from starlette.background import BackgroundTask

from app.cookies import REFRESH_COOKIE, clear_refresh_cookie, set_refresh_cookie
from app.db import (
    PROVIDER_LOCAL,
    ROLE_ADMIN,
    identity_document,
    user_document,
    utcnow,
)
from app.deps import DPoPProofDep, Services, ServicesDep, dpop_unauthorized
from app.errors import www_authenticate_dpop
from app.ratelimit import LOGIN_PER_EMAIL, LOGIN_PER_IP, REFRESH_PER_FAMILY, REGISTER_PER_IP
from app.schemas import ErrorResponse, LoginRequest, RegisterRequest, TokenResponse
from app.security.passwords import PasswordHasherBusyError
from app.services.email_verification import (
    deliver,
    issue_verification_token,
    verification_email,
)
from app.services.sessions import IssuedSession, RefreshError, RefreshOutcome, TokenRef

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


async def password_login(
    services: Services, payload: LoginRequest, *, jkt: str, admin: bool = False
) -> IssuedSession | None:
    """Shared by the customer and the admin login. None = invalid credentials (one
    generic answer, same Argon2id work for unknown users, spec §4.2)."""
    allowed = {"isActive": True, "role": ROLE_ADMIN} if admin else {"isActive": True}
    user = await services.db.users.find_one(
        {"email": payload.email},
        {"passwordHash": 1, "isActive": 1, "role": 1},
    )
    if (
        user is None
        or user["passwordHash"] is None
        or any(user[k] != v for k, v in allowed.items())
    ):
        await services.passwords.dummy_verify(payload.password)
        return None
    password_hash: str = user["passwordHash"]
    if not await services.passwords.verify(password_hash, payload.password):
        return None
    if services.passwords.hasher.check_needs_rehash(password_hash):
        try:
            new_hash = await services.passwords.hash(payload.password)
        except PasswordHasherBusyError:
            new_hash = None  # best effort: rehash again on a later login
        if new_hash is not None:
            # Compare-and-swap: never resurrect a password removed meanwhile (takeover).
            swapped = await services.db.users.update_one(
                {"_id": user["_id"], "passwordHash": password_hash},
                {"$set": {"passwordHash": new_hash, "updatedAt": utcnow()}},
            )
            if swapped.modified_count:
                password_hash = new_hash
    issued = await services.sessions.create_session(user_id=user["_id"], jkt=jkt)
    # Re-check AFTER the session exists that the verified hash is still current. A Google
    # takeover (routers/google.py) first removes the password, THEN revokes every family:
    # either this read sees the password gone (the new family is revoked here), or it ran
    # before the removal, so the family already existed and the takeover revokes it.
    if (
        await services.db.users.find_one(
            {"_id": user["_id"], "passwordHash": password_hash, **allowed}, {"_id": 1}
        )
        is None
    ):
        await services.sessions.revoke_family(issued.family_id, reason="credentials_changed")
        return None
    return issued


# --- rate-limit dependencies (resolved BEFORE body validation / DPoP) ------------------
async def _rl_register(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(REGISTER_PER_IP, services.client_ip.for_request(request))


async def _rl_login_ip(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(LOGIN_PER_IP, services.client_ip.for_request(request))


async def presented_refresh_token(
    services: ServicesDep, refresh: RefreshCookie = None
) -> TokenRef | None:
    """Looked up once per request: FastAPI caches it for the rate limit AND the handler."""
    return await services.sessions.lookup(refresh)


RefreshTokenRef = Annotated[TokenRef | None, Depends(presented_refresh_token)]


async def _rl_refresh(request: Request, services: ServicesDep, ref: RefreshTokenRef) -> None:
    identifier = (
        f"family:{ref.family_id}"
        if ref is not None
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
    proof: DPoPProofDep,
    payload: Annotated[RegisterRequest, Body()],
) -> JSONResponse:
    password_hash = await services.passwords.hash(payload.password)
    now = utcnow()
    user = user_document(
        email=payload.email,
        password_hash=password_hash,
        is_verified=False,
        identities=[identity_document(PROVIDER_LOCAL, payload.email, now)],
        now=now,
    )
    try:
        await services.db.users.insert_one(user)
    except DuplicateKeyError:
        # D-A12: generic failure, no "email already exists" message.
        return error_response(400, REGISTRATION_FAILED)
    # Email verification (AGGIUNTA). The account is written first: if a later write
    # fails the account simply has no token/session yet (resend / login recover it).
    raw_token = await issue_verification_token(
        services.db, user["_id"], ttl_seconds=services.settings.email_verification_ttl_seconds
    )
    issued = await services.sessions.create_session(user_id=user["_id"], jkt=proof.jkt)
    # Same post-session re-check as password_login: a Google takeover that ran between
    # the account insert and the session creation found no family to revoke; it has
    # removed the password, so this session is revoked here and nothing is handed out.
    if (
        await services.db.users.find_one(
            {"_id": user["_id"], "passwordHash": password_hash, "isActive": True}, {"_id": 1}
        )
        is None
    ):
        await services.sessions.revoke_family(issued.family_id, reason="credentials_changed")
        return error_response(400, REGISTRATION_FAILED)
    response = token_response(
        issued, status_code=201, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )
    # Sent AFTER the response (no added latency); a delivery failure never fails the
    # registration (it is logged without recipient/body/link; the user can resend).
    response.background = BackgroundTask(
        deliver,
        services.mailer,
        verification_email(services.settings, to=payload.email, raw_token=raw_token),
    )
    return response


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse, "description": INVALID_CREDENTIALS}, **_429},
    dependencies=[Depends(_rl_login_ip)],
)
async def login(
    services: ServicesDep,
    proof: DPoPProofDep,
    payload: Annotated[LoginRequest, Body()],
) -> JSONResponse:
    await services.rate_limiter.hit(LOGIN_PER_EMAIL, payload.email)
    issued = await password_login(services, payload, jkt=proof.jkt)
    if issued is None:
        return error_response(401, INVALID_CREDENTIALS)
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
    proof: DPoPProofDep,
    ref: RefreshTokenRef,
    refresh_token: RefreshCookie = None,
) -> JSONResponse:
    if not refresh_token:
        return error_response(401, "Missing refresh token")
    try:
        issued = await services.sessions.rotate(ref, jkt=proof.jkt)
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
    proof: DPoPProofDep,
    ref: RefreshTokenRef,
    refresh_token: RefreshCookie = None,
) -> Response:
    if not refresh_token:
        return error_response(401, "Missing refresh token")
    if not await services.sessions.logout(ref, jkt=proof.jkt):
        raise dpop_unauthorized("DPoP key does not match refresh token binding")
    response = Response(status_code=204)
    clear_refresh_cookie(response)
    return response

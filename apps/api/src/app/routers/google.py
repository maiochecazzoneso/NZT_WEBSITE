"""Google OIDC endpoints (spec §5, §8.4, D-A11)."""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Body, Cookie, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cookies import OAUTH_STATE_COOKIE, clear_oauth_state_cookie, set_oauth_state_cookie
from app.deps import DbSession, DPoPProofDep, ServicesDep
from app.models import AuthIdentity, User
from app.ratelimit import GOOGLE_AUTHORIZE_PER_IP, GOOGLE_CALLBACK_PER_IP
from app.routers.auth import token_response
from app.schemas import ErrorResponse, GoogleAuthorizeResponse, GoogleCallbackRequest, TokenResponse
from app.security.sealed import SealError
from app.services.email_verification import invalidate_pending_tokens
from app.services.google import OAUTH_STATE_TTL_SECONDS, GoogleIdentity, OIDCError
from app.services.sessions import SessionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth/google", tags=["auth-google"])

OAuthStateCookie = Annotated[str | None, Cookie(alias=OAUTH_STATE_COOKIE)]
STATE_ALREADY_USED = "OAuth state already used"
# Consumed-state markers outlive the sealed state's own validity (+ clock margin).
_STATE_USED_TTL_SECONDS = OAUTH_STATE_TTL_SECONDS + 60
_429: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorResponse, "description": "Rate limited (Retry-After)"}
}


async def _rl_authorize(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(
        GOOGLE_AUTHORIZE_PER_IP, services.client_ip.for_request(request)
    )


async def _rl_callback(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(GOOGLE_CALLBACK_PER_IP, services.client_ip.for_request(request))


def _fail(status_code: int, detail: str) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    clear_oauth_state_cookie(response)  # one-shot: never reusable after a callback
    return response


@router.get(
    "/authorize",
    response_model=GoogleAuthorizeResponse,
    responses={503: {"model": ErrorResponse}, **_429},
    dependencies=[Depends(_rl_authorize)],
)
async def authorize(services: ServicesDep) -> JSONResponse:
    if not services.google.configured:
        return JSONResponse(status_code=503, content={"detail": "Google sign-in not configured"})
    req = services.google.build_authorization_request()
    sealed = services.sealer.seal(
        {
            "state": req.state,
            "code_verifier": req.code_verifier,
            "nonce": req.nonce,
            "exp": int(time.time()) + OAUTH_STATE_TTL_SECONDS,
        }
    )
    response = JSONResponse(
        status_code=200, content=GoogleAuthorizeResponse(authorization_url=req.url).model_dump()
    )
    set_oauth_state_cookie(response, sealed, OAUTH_STATE_TTL_SECONDS)
    return response


@dataclass(frozen=True, slots=True)
class ResolvedUser:
    user_id: uuid.UUID
    took_over: bool = False


async def _take_over_unverified_account(
    db: AsyncSession, sessions: SessionService, user_id: uuid.UUID
) -> None:
    """DEVIATION from spec §5.3 (decided, documented in architettura_sicurezza §11.3):
    a VERIFIED Google identity (email_verified=true, proof of mailbox ownership) that
    meets an UNVERIFIED local account for the same email takes control of it, instead of
    being refused with 403 forever (review M2, account pre-hijacking). The unverified
    local credential is neutralised: password removed, local identity deleted, pending
    verification tokens deleted, EVERY refresh-token family revoked + user revocation
    marker (already-issued access tokens die; the marker is moved again after commit by
    the caller). Runs with the users row locked FOR UPDATE (see _resolve_user)."""
    await db.execute(
        delete(AuthIdentity)
        .where(AuthIdentity.user_id == user_id, AuthIdentity.provider == "local")
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=None, is_verified=True)
        .execution_options(synchronize_session=False)
    )
    await invalidate_pending_tokens(db, user_id)
    await sessions.revoke_all_for_user(db, user_id, reason="google_takeover")
    logger.warning(
        "SECURITY: unverified local account %s taken over by a verified Google identity; "
        "password removed and all sessions revoked",
        user_id,
    )


async def _resolve_user(
    db: AsyncSession, sessions: SessionService, identity: GoogleIdentity
) -> ResolvedUser | JSONResponse:
    """Spec §5.3 account linking / pre-hijacking prevention (+ takeover, see above)."""
    linked = await db.execute(
        select(User.id, User.is_active)
        .join(AuthIdentity, AuthIdentity.user_id == User.id)
        .where(AuthIdentity.provider == "google", AuthIdentity.provider_user_id == identity.sub)
    )
    row = linked.one_or_none()
    if row is not None:
        return ResolvedUser(row.id) if row.is_active else _fail(403, "Account is disabled")

    # FOR UPDATE: serialises with a concurrent password login (routers/auth.py re-checks
    # the hash under the same lock) and with /verify-email (same lock order).
    existing = await db.execute(
        select(User.id, User.is_verified, User.is_active)
        .where(func.lower(User.email) == identity.email)
        .with_for_update()
    )
    user = existing.one_or_none()
    if user is not None:
        if not user.is_active:
            return _fail(403, "Account is disabled")
        other_google = await db.execute(
            select(AuthIdentity.id).where(
                AuthIdentity.user_id == user.id, AuthIdentity.provider == "google"
            )
        )
        if other_google.first() is not None:
            return _fail(409, "Account already linked to a different Google identity")
        took_over = not user.is_verified
        if took_over:
            await _take_over_unverified_account(db, sessions, user.id)
        db.add(
            AuthIdentity(
                id=uuid.uuid4(), user_id=user.id, provider="google", provider_user_id=identity.sub
            )
        )
        await db.flush()
        return ResolvedUser(user.id, took_over=took_over)

    new_user = User(id=uuid.uuid4(), email=identity.email, password_hash=None, is_verified=True)
    db.add(new_user)
    await db.flush()
    db.add(
        AuthIdentity(
            id=uuid.uuid4(), user_id=new_user.id, provider="google", provider_user_id=identity.sub
        )
    )
    await db.flush()
    return ResolvedUser(new_user.id)


@router.post(
    "/callback",
    response_model=TokenResponse,
    responses={
        400: {"model": ErrorResponse, "description": "State mismatch / IdP rejection"},
        401: {"model": ErrorResponse, "description": "Invalid DPoP proof"},
        403: {"model": ErrorResponse, "description": "Account disabled"},
        409: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        **_429,
    },
    dependencies=[Depends(_rl_callback)],
)
async def callback(
    services: ServicesDep,
    db: DbSession,
    proof: DPoPProofDep,
    payload: Annotated[GoogleCallbackRequest, Body()],
    state_cookie: OAuthStateCookie = None,
) -> JSONResponse:
    if not services.google.configured:
        return _fail(503, "Google sign-in not configured")
    if not state_cookie:
        return _fail(400, "Invalid OAuth state")
    try:
        sealed = services.sealer.unseal(state_cookie)
    except SealError:
        return _fail(400, "Invalid OAuth state")
    state, verifier, nonce, exp = (
        sealed.get("state"),
        sealed.get("code_verifier"),
        sealed.get("nonce"),
        sealed.get("exp"),
    )
    if not (
        isinstance(state, str)
        and isinstance(verifier, str)
        and isinstance(nonce, str)
        and type(exp) is int
    ):
        return _fail(400, "Invalid OAuth state")
    if exp < int(time.time()):
        return _fail(400, "OAuth state expired")
    if not hmac.compare_digest(state.encode(), payload.state.encode()):
        return _fail(400, "Invalid OAuth state")
    # Single use (review L6): the first valid callback consumes the state server-side, so a
    # replayed cookie+state never reaches Google's token endpoint again. Redis errors =>
    # 503 (fail-closed, via the RedisError handler).
    consumed = await services.redis.set(
        "oauth_state_used:" + hashlib.sha256(state.encode()).hexdigest(),
        "1",
        nx=True,
        ex=_STATE_USED_TTL_SECONDS,
    )
    if not consumed:
        return _fail(400, STATE_ALREADY_USED)

    try:
        identity = await services.google.exchange_code(
            code=payload.code, code_verifier=verifier, nonce=nonce
        )
    except OIDCError as exc:
        return _fail(exc.status, exc.description)

    try:
        resolved = await _resolve_user(db, services.sessions, identity)
    except IntegrityError:
        await db.rollback()
        return _fail(409, "Account linking conflict, please retry")
    if isinstance(resolved, JSONResponse):
        await db.rollback()
        return resolved
    if resolved.took_over:
        # Commit the takeover first, then kill every access token issued up to now and
        # only then create the owner's session (see SessionService docstring).
        await db.commit()
        await services.sessions.kill_user_access_tokens_after_commit(resolved.user_id)
    issued = await services.sessions.create_session(db, user_id=resolved.user_id, jkt=proof.jkt)
    await db.commit()
    response = token_response(
        issued, status_code=200, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )
    clear_oauth_state_cookie(response)
    return response

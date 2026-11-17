"""Google OIDC endpoints (spec §5, §8.4, D-A11)."""

from __future__ import annotations

import hmac
import logging
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cookies import OAUTH_STATE_COOKIE, clear_oauth_state_cookie, set_oauth_state_cookie
from app.deps import DbSession, DPoPProofDep, ServicesDep
from app.models import AuthIdentity, User
from app.routers.auth import token_response
from app.schemas import ErrorResponse, GoogleAuthorizeResponse, GoogleCallbackRequest, TokenResponse
from app.security.sealed import SealError
from app.services.google import OAUTH_STATE_TTL_SECONDS, GoogleIdentity, OIDCError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth/google", tags=["auth-google"])

UNVERIFIED_LOCAL_ACCOUNT = (
    "An account with this email already exists but is not verified. "
    "Verify the local account before signing in with Google."
)
OAuthStateCookie = Annotated[str | None, Cookie(alias=OAUTH_STATE_COOKIE)]


def _fail(status_code: int, detail: str) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    clear_oauth_state_cookie(response)  # one-shot: never reusable after a callback
    return response


@router.get(
    "/authorize",
    response_model=GoogleAuthorizeResponse,
    responses={503: {"model": ErrorResponse}},
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


async def _resolve_user(db: AsyncSession, identity: GoogleIdentity) -> uuid.UUID | JSONResponse:
    """Spec §5.3 account linking / pre-hijacking prevention."""
    linked = await db.execute(
        select(User.id, User.is_active)
        .join(AuthIdentity, AuthIdentity.user_id == User.id)
        .where(AuthIdentity.provider == "google", AuthIdentity.provider_user_id == identity.sub)
    )
    row = linked.one_or_none()
    if row is not None:
        return row.id if row.is_active else _fail(403, "Account is disabled")

    existing = await db.execute(
        select(User.id, User.is_verified, User.is_active).where(
            func.lower(User.email) == identity.email
        )
    )
    user = existing.one_or_none()
    if user is not None:
        if not user.is_active:
            return _fail(403, "Account is disabled")
        if not user.is_verified:
            return _fail(403, UNVERIFIED_LOCAL_ACCOUNT)
        other_google = await db.execute(
            select(AuthIdentity.id).where(
                AuthIdentity.user_id == user.id, AuthIdentity.provider == "google"
            )
        )
        if other_google.first() is not None:
            return _fail(409, "Account already linked to a different Google identity")
        db.add(
            AuthIdentity(
                id=uuid.uuid4(), user_id=user.id, provider="google", provider_user_id=identity.sub
            )
        )
        await db.flush()
        linked_id: uuid.UUID = user.id
        return linked_id

    new_user = User(id=uuid.uuid4(), email=identity.email, password_hash=None, is_verified=True)
    db.add(new_user)
    await db.flush()
    db.add(
        AuthIdentity(
            id=uuid.uuid4(), user_id=new_user.id, provider="google", provider_user_id=identity.sub
        )
    )
    await db.flush()
    return new_user.id


@router.post(
    "/callback",
    response_model=TokenResponse,
    responses={
        400: {"model": ErrorResponse, "description": "State mismatch / IdP rejection"},
        401: {"model": ErrorResponse, "description": "Invalid DPoP proof"},
        403: {"model": ErrorResponse, "description": "Unverified local account / disabled"},
        409: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
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
        and isinstance(exp, int)
    ):
        return _fail(400, "Invalid OAuth state")
    if exp < int(time.time()):
        return _fail(400, "OAuth state expired")
    if not hmac.compare_digest(state.encode(), payload.state.encode()):
        return _fail(400, "Invalid OAuth state")

    try:
        identity = await services.google.exchange_code(
            code=payload.code, code_verifier=verifier, nonce=nonce
        )
    except OIDCError as exc:
        return _fail(exc.status, exc.description)

    try:
        resolved = await _resolve_user(db, identity)
    except IntegrityError:
        await db.rollback()
        return _fail(409, "Account linking conflict, please retry")
    if isinstance(resolved, JSONResponse):
        await db.rollback()
        return resolved
    issued = await services.sessions.create_session(db, user_id=resolved, jkt=proof.jkt)
    await db.commit()
    response = token_response(
        issued, status_code=200, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )
    clear_oauth_state_cookie(response)
    return response

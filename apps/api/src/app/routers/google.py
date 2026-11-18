"""Google OIDC endpoints (spec §5, §8.4, D-A11)."""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Cookie, Depends, Request
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError

from app.cookies import OAUTH_STATE_COOKIE, clear_oauth_state_cookie, set_oauth_state_cookie
from app.db import (
    EMAIL_COLLATION,
    PROVIDER_GOOGLE,
    Collections,
    Document,
    identity_document,
    identity_filter,
    user_document,
    utcnow,
)
from app.deps import DPoPProofDep, ServicesDep
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
    revoked_marker_ms: int | None = None  # set when an unverified account was taken over


async def _take_over_unverified_account(
    db: Collections,
    sessions: SessionService,
    user_id: uuid.UUID,
    google_identity: Document,
    now: datetime,
) -> int | None:
    """DEVIATION from spec §5.3 (decided, documented in architettura_sicurezza §11.3):
    a VERIFIED Google identity (email_verified=true, proof of mailbox ownership) that
    meets an UNVERIFIED local account for the same email takes control of it, instead of
    being refused with 403 forever (review M2, account pre-hijacking). Every credential of
    the unverified registrant is neutralised: password removed, identities replaced by the
    Google one, pending verification tokens deleted, EVERY refresh-token family revoked +
    user revocation marker (already-issued access tokens die).

    The first step is ONE atomic compare-and-swap on the user document (still unverified,
    active, no Google identity): a concurrent /verify-email or Google sign-in makes it
    fail cleanly, and a concurrent password login notices the removed password through
    its post-session re-check (routers/auth.py). Returns the revocation marker, or None
    when the account no longer qualifies."""
    swapped = await db.users.update_one(
        {
            "_id": user_id,
            "isVerified": False,
            "isActive": True,
            "identities.provider": {"$ne": PROVIDER_GOOGLE},
        },
        {
            "$set": {
                "passwordHash": None,
                "isVerified": True,
                "identities": [google_identity],
                "updatedAt": now,
            }
        },
    )
    if swapped.modified_count == 0:
        return None
    await invalidate_pending_tokens(db, user_id)
    marker = await sessions.revoke_all_for_user(user_id, reason="google_takeover")
    logger.warning(
        "SECURITY: unverified local account %s taken over by a verified Google identity; "
        "password removed and all sessions revoked",
        user_id,
    )
    return marker


async def _resolve_user(
    db: Collections, sessions: SessionService, identity: GoogleIdentity
) -> ResolvedUser | JSONResponse:
    """Spec §5.3 account linking / pre-hijacking prevention (+ takeover, see above).
    DuplicateKeyError (concurrent sign-up / linking) is mapped to 409 by the caller."""
    linked = await db.users.find_one(
        identity_filter(PROVIDER_GOOGLE, identity.sub), {"isActive": 1}
    )
    if linked is not None:
        if not linked["isActive"]:
            return _fail(403, "Account is disabled")
        return ResolvedUser(linked["_id"])

    now = utcnow()
    google_identity = identity_document(PROVIDER_GOOGLE, identity.sub, now)
    user = await db.users.find_one(
        {"email": identity.email},
        {"isVerified": 1, "isActive": 1, "identities.provider": 1},
        collation=EMAIL_COLLATION,
    )
    if user is None:
        new_user = user_document(
            email=identity.email,
            password_hash=None,
            is_verified=True,
            identities=[google_identity],
            now=now,
        )
        await db.users.insert_one(new_user)
        return ResolvedUser(new_user["_id"])

    if not user["isActive"]:
        return _fail(403, "Account is disabled")
    if any(i["provider"] == PROVIDER_GOOGLE for i in user["identities"]):
        return _fail(409, "Account already linked to a different Google identity")
    if not user["isVerified"]:
        marker = await _take_over_unverified_account(
            db, sessions, user["_id"], google_identity, now
        )
        if marker is not None:
            return ResolvedUser(user["_id"], revoked_marker_ms=marker)
    # Verified account (or verified meanwhile): link. The filter re-checks atomically that
    # it is still active and has no Google identity; a lost race is a retryable conflict.
    linked_now = await db.users.update_one(
        {
            "_id": user["_id"],
            "isActive": True,
            "isVerified": True,
            "identities.provider": {"$ne": PROVIDER_GOOGLE},
        },
        {"$push": {"identities": google_identity}, "$set": {"updatedAt": now}},
    )
    if linked_now.modified_count == 0:
        return _fail(409, "Account linking conflict, please retry")
    return ResolvedUser(user["_id"])


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
        resolved = await _resolve_user(services.db, services.sessions, identity)
    except DuplicateKeyError:
        return _fail(409, "Account linking conflict, please retry")
    if isinstance(resolved, JSONResponse):
        return resolved
    if resolved.revoked_marker_ms is not None:
        # Every access token issued up to the takeover is dead; the owner's session is
        # created only once the shared clock has moved past the marker.
        await services.sessions.wait_until_after(resolved.revoked_marker_ms)
    issued = await services.sessions.create_session(user_id=resolved.user_id, jkt=proof.jkt)
    response = token_response(
        issued, status_code=200, refresh_ttl=services.settings.refresh_token_ttl_seconds
    )
    clear_oauth_state_cookie(response)
    return response

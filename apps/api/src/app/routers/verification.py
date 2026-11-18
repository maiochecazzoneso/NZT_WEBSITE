"""Email verification endpoints (AGGIUNTA rispetto alla specifica §8):

* ``POST /api/v1/auth/verify-email`` {token} - public (the owner of the mailbox is not
  necessarily logged in), no DPoP (it creates no session), 10/min per client IP;
  unknown / malformed / used / expired token => ONE generic 400; success => 204.
* ``POST /api/v1/auth/resend-verification`` - DPoP-authenticated, uses the authenticated
  user's OWN email (no enumeration), 3/h per user + 10/h per IP; already verified => 204
  no-op; otherwise previous pending tokens are invalidated and a new email is sent.
* ``GET /api/v1/auth/me`` - DPoP-authenticated, returns only {email, is_verified}.

Unverified accounts keep every existing capability (login, refresh, downloads):
verification only decides who controls the account when a verified Google identity for
the same email arrives (routers/google.py)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.deps import CurrentUser, ServicesDep
from app.ratelimit import (
    RESEND_VERIFICATION_PER_IP,
    RESEND_VERIFICATION_PER_USER,
    VERIFY_EMAIL_PER_IP,
)
from app.schemas import ErrorResponse, MeResponse, VerifyEmailRequest
from app.services.email_verification import (
    consume_verification_token,
    deliver,
    issue_verification_token,
    verification_email,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth-email"])

INVALID_VERIFICATION_TOKEN = "Invalid or expired verification token"  # noqa: S105
EMAIL_DELIVERY_FAILED = "Email delivery failed"

_429: dict[int | str, dict[str, Any]] = {
    429: {"model": ErrorResponse, "description": "Rate limited (Retry-After)"},
    503: {"model": ErrorResponse, "description": "Dependency down"},
}


async def _rl_verify(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(VERIFY_EMAIL_PER_IP, services.client_ip.for_request(request))


async def _rl_resend_ip(request: Request, services: ServicesDep) -> None:
    await services.rate_limiter.hit(
        RESEND_VERIFICATION_PER_IP, services.client_ip.for_request(request)
    )


@router.post(
    "/verify-email",
    status_code=204,
    response_class=Response,
    responses={400: {"model": ErrorResponse, "description": "Generic token failure"}, **_429},
    dependencies=[Depends(_rl_verify)],
)
async def verify_email(
    services: ServicesDep, payload: Annotated[VerifyEmailRequest, Body()]
) -> Response:
    if await consume_verification_token(services.db, payload.token) is None:
        return JSONResponse(status_code=400, content={"detail": INVALID_VERIFICATION_TOKEN})
    return Response(status_code=204)


@router.post(
    "/resend-verification",
    status_code=204,
    response_class=Response,
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated (DPoP)"},
        **_429,
    },
    dependencies=[Depends(_rl_resend_ip)],
)
async def resend_verification(services: ServicesDep, user: CurrentUser) -> Response:
    await services.rate_limiter.hit(RESEND_VERIFICATION_PER_USER, str(user.id))
    if user.is_verified:  # read from the database by the authentication of this request
        return Response(status_code=204)
    raw_token = await issue_verification_token(
        services.db, user.id, ttl_seconds=services.settings.email_verification_ttl_seconds
    )
    message = verification_email(services.settings, to=user.email, raw_token=raw_token)
    if not await deliver(services.mailer, message):
        return JSONResponse(status_code=503, content={"detail": EMAIL_DELIVERY_FAILED})
    return Response(status_code=204)


@router.get(
    "/me",
    response_model=MeResponse,
    responses={401: {"model": ErrorResponse, "description": "Not authenticated (DPoP)"}},
)
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse(email=user.email, is_verified=user.is_verified)

"""Structured error handling. Every error body is JSON ``{"detail": ...}``; validation
errors never echo the submitted input (passwords!) and no stack traces are returned."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError

from app.ratelimit import RateLimitExceededError, RateLimitUnavailableError

logger = logging.getLogger(__name__)

DPOP_ALGS = 'algs="ES256"'


def www_authenticate_dpop(error: str | None = None, description: str | None = None) -> str:
    """RFC 9449 §7.1 / RFC 6750 §3 style challenge."""
    parts: list[str] = []
    if error:
        parts.append(f'error="{error}"')
    if description:
        safe = description.replace('"', "'").replace("\\", "/")
        parts.append(f'error_description="{safe}"')
    parts.append(DPOP_ALGS)
    return "DPoP " + ", ".join(parts)


async def _validation_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    cleaned = [
        {"loc": list(err.get("loc", ())), "msg": str(err.get("msg", "")), "type": err.get("type")}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": cleaned})


async def _rate_limited_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RateLimitExceededError)
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests"},
        headers={"Retry-After": str(exc.retry_after)},
    )


async def _unavailable_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("dependency unavailable: %s", type(exc).__name__)
    return JSONResponse(
        status_code=503,
        content={"detail": "Service temporarily unavailable"},
        headers={"Retry-After": "5"},
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(RateLimitExceededError, _rate_limited_handler)
    app.add_exception_handler(RateLimitUnavailableError, _unavailable_handler)
    app.add_exception_handler(RedisError, _unavailable_handler)

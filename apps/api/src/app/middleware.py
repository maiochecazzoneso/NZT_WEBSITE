"""Pure-ASGI middlewares: security headers (spec §9.1) + last-resort error guard, and a
request body size limit. Pure ASGI (not BaseHTTPMiddleware) so headers are also added to
CORS preflights, 4xx/5xx and any response produced by inner middlewares."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings

logger = logging.getLogger(__name__)

GOOGLE_CSP_ORIGINS = ("https://accounts.google.com", "https://oauth2.googleapis.com")


def build_csp(settings: Settings) -> str:
    connect: list[str] = ["'self'", *GOOGLE_CSP_ORIGINS]
    for origin in (
        settings.api_public_base_url,
        *settings.portal_origins,
        settings.storage_public_origin,
    ):
        if origin not in connect:
            connect.append(origin)
    return (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        f"connect-src {' '.join(connect)}; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
    )


def security_headers(settings: Settings) -> list[tuple[bytes, bytes]]:
    headers = {
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": build_csp(settings),
        # Addition: API responses carry tokens/presigned URLs -> never cache.
        "Cache-Control": "no-store",
    }
    return [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]


def _merge(
    existing: Iterable[tuple[bytes, bytes]], extra: list[tuple[bytes, bytes]]
) -> list[tuple[bytes, bytes]]:
    names = {k for k, _ in extra}
    return [(k, v) for k, v in existing if k.lower() not in names] + extra


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.headers = security_headers(settings)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message["headers"] = _merge(message.get("headers", []), self.headers)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            # Never leak stack traces; log type + path only.
            logger.exception("unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                return
            body = json.dumps({"detail": "Internal server error"}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": _merge(
                        [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                        self.headers,
                    ),
                }
            )
            await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _reject(self, send: Send) -> None:
        body = json.dumps({"detail": "Request body too large"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_big = int(value) > self.max_bytes
                except ValueError:
                    too_big = True
                if too_big:
                    await self._reject(send)
                    return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Raised inside the route's body read -> handled by FastAPI as 413.
                    raise HTTPException(status_code=413, detail="Request body too large")
            return message

        await self.app(scope, limited_receive, send)

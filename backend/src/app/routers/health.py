"""Operational liveness/readiness probe (operational minimum, not in spec)."""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.deps import ServicesDep
from app.schemas import HealthResponse

router = APIRouter(tags=["ops"])

_HEALTH_CACHE_TTL_SECONDS = 2.0
_HEALTH_PROBE_TIMEOUT_SECONDS = 2.0
_health_lock = asyncio.Lock()
_last_checked_at = 0.0
_last_ok = False


@router.get("/healthz", response_model=HealthResponse, responses={503: {}})
async def healthz(services: ServicesDep) -> JSONResponse:
    global _last_checked_at, _last_ok
    now = time.monotonic()
    if now - _last_checked_at < _HEALTH_CACHE_TTL_SECONDS:
        if _last_ok:
            return JSONResponse(status_code=200, content={"status": "ok"})
        return JSONResponse(status_code=503, content={"detail": "unavailable"})
    async with _health_lock:
        now = time.monotonic()
        if now - _last_checked_at < _HEALTH_CACHE_TTL_SECONDS:
            if _last_ok:
                return JSONResponse(status_code=200, content={"status": "ok"})
            return JSONResponse(status_code=503, content={"detail": "unavailable"})
        try:
            async with asyncio.timeout(_HEALTH_PROBE_TIMEOUT_SECONDS):
                await asyncio.gather(
                    services.mongo.admin.command("ping"),
                    services.redis.ping(),
                )
            _last_ok = True
        except Exception:
            _last_ok = False
        _last_checked_at = time.monotonic()
    if _last_ok:
        return JSONResponse(status_code=200, content={"status": "ok"})
    return JSONResponse(status_code=503, content={"detail": "unavailable"})

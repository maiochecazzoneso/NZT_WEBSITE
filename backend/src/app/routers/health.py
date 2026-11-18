"""Operational liveness/readiness probe (operational minimum, not in spec)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.deps import ServicesDep
from app.schemas import HealthResponse

router = APIRouter(tags=["ops"])


@router.get("/healthz", response_model=HealthResponse, responses={503: {}})
async def healthz(services: ServicesDep) -> JSONResponse:
    try:
        await services.mongo.admin.command("ping")
        await services.redis.ping()
    except Exception:
        return JSONResponse(status_code=503, content={"detail": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ok"})

"""Protected launcher distribution (spec §7, §8.5, D-A13)."""

from __future__ import annotations

import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.db import utcnow
from app.deps import (
    AuthenticatedUser,
    CurrentUser,
    ServicesDep,
    require_entitlement,
)
from app.ratelimit import DOWNLOADS_PER_USER
from app.schemas import DownloadResponse, ErrorResponse
from app.services.storage import PRESIGNED_URL_TTL_SECONDS, Product, artifact_catalog

router = APIRouter(prefix="/api/v1/downloads", tags=["downloads"])

_MAX_USER_AGENT = 512


async def rate_limit_downloads(user: CurrentUser, services: ServicesDep) -> None:
    """Spec §9.2: /api/v1/downloads/* max 10 requests/hour per user."""
    await services.rate_limiter.hit(DOWNLOADS_PER_USER, str(user.id))


@router.get(
    "/launcher",
    response_model=DownloadResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Invalid DPoP / access token"},
        403: {"model": ErrorResponse, "description": "No active entitlement"},
        429: {"model": ErrorResponse, "description": "Rate limited (Retry-After)"},
    },
    dependencies=[Depends(rate_limit_downloads)],
)
async def download_launcher(
    request: Request,
    services: ServicesDep,
    user: Annotated[AuthenticatedUser, Depends(require_entitlement(Product.LAUNCHER_CORE.value))],
) -> DownloadResponse:
    artifact = artifact_catalog(services.settings)[Product.LAUNCHER_CORE]
    download_token_id = secrets.token_hex(16)
    user_agent = request.headers.get("user-agent")
    # Audit row acknowledged by the replica-set majority BEFORE the URL is handed out.
    await services.db.download_logs.insert_one(
        {
            "_id": uuid.uuid4(),
            "userId": user.id,
            "productCode": artifact.product.value,
            "ipAddress": services.client_ip.for_request(request),
            "userAgent": user_agent[:_MAX_USER_AGENT] if user_agent else None,
            "downloadTokenId": download_token_id,
            "createdAt": utcnow(),
        }
    )
    return DownloadResponse(
        download_url=services.presigner.presign_get(artifact),
        sha256=artifact.sha256,
        version=artifact.version,
        expires_in=PRESIGNED_URL_TTL_SECONDS,
    )

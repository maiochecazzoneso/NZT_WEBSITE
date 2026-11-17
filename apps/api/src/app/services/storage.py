"""Launcher artefacts + SigV4 presigned GET URLs (spec §7, D-A13).

File pointers come ONLY from the server-side ``Product`` enum and settings; no request
data ever reaches the bucket key. Presigning is a local HMAC-SHA256 computation (no
network)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import boto3
from botocore.config import Config

from app.config import Settings

PRESIGNED_URL_TTL_SECONDS = 300
LAUNCHER_FILENAME = "NZT-Launcher.exe"


class Product(StrEnum):
    LAUNCHER_CORE = "launcher_core"


@dataclass(frozen=True, slots=True)
class Artifact:
    product: Product
    object_key: str
    version: str
    sha256: str
    filename: str


def artifact_catalog(settings: Settings) -> dict[Product, Artifact]:
    version = settings.launcher_version  # validated MAJOR.MINOR.PATCH at startup
    return {
        Product.LAUNCHER_CORE: Artifact(
            product=Product.LAUNCHER_CORE,
            object_key=f"binaries/launcher/v{version}/{LAUNCHER_FILENAME}",
            version=version,
            sha256=settings.launcher_sha256,
            filename=LAUNCHER_FILENAME,
        )
    }


class Presigner:
    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.storage_bucket
        access = settings.storage_access_key_id
        secret = settings.storage_secret_access_key
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=settings.storage_endpoint_url,
            region_name=settings.storage_region,
            aws_access_key_id=access.get_secret_value() if access else "dev-access-key",
            aws_secret_access_key=secret.get_secret_value() if secret else "dev-secret-key",
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": settings.storage_addressing_style},
            ),
        )

    def presign_get(self, artifact: Artifact) -> str:
        url: str = self._client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket,
                "Key": artifact.object_key,
                "ResponseContentDisposition": f'attachment; filename="{artifact.filename}"',
            },
            ExpiresIn=PRESIGNED_URL_TTL_SECONDS,
            HttpMethod="GET",
        )
        return url

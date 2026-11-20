"""Launcher artefacts + SigV4 presigned GET URLs (spec §7, D-A13).

File pointers come ONLY from the server-side ``Product`` enum and settings; no request
data ever reaches the bucket key. Presigning is a local HMAC-SHA256 computation (no
network, pure stdlib without boto3/botocore overhead)."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from urllib.parse import quote, urlencode, urlsplit

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


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _sigv4_signing_key(secret_key: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _hmac_sha256(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, service)
    return _hmac_sha256(k_service, "aws4_request")


class Presigner:
    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.storage_bucket
        self._endpoint = urlsplit(settings.storage_endpoint_url.rstrip("/"))
        self._region = settings.storage_region
        self._addressing_style = settings.storage_addressing_style
        access = settings.storage_access_key_id
        secret = settings.storage_secret_access_key
        self._access_key = access.get_secret_value() if access else "dev-access-key"
        self._secret_key = secret.get_secret_value() if secret else "dev-secret-key"

    def presign_get(self, artifact: Artifact, *, now: datetime | None = None) -> str:
        dt = (now or datetime.now(UTC)).astimezone(UTC)
        amz_date = dt.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = dt.strftime("%Y%m%d")

        base_path = self._endpoint.path.rstrip("/")
        key_path = quote(artifact.object_key, safe="/-_.~")
        if self._addressing_style == "virtual":
            host = f"{self._bucket}.{self._endpoint.netloc}"
            canonical_uri = f"{base_path}/{key_path}"
        else:
            host = self._endpoint.netloc
            canonical_uri = f"{base_path}/{quote(self._bucket, safe='-_.~')}/{key_path}"

        credential_scope = f"{date_stamp}/{self._region}/s3/aws4_request"
        query_params = [
            ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
            ("X-Amz-Credential", f"{self._access_key}/{credential_scope}"),
            ("X-Amz-Date", amz_date),
            ("X-Amz-Expires", str(PRESIGNED_URL_TTL_SECONDS)),
            ("X-Amz-SignedHeaders", "host"),
            ("response-content-disposition", f'attachment; filename="{artifact.filename}"'),
            ("response-content-type", "application/octet-stream"),
        ]
        # SigV4 requires canonical query string sorted by parameter name.
        query_params.sort(key=lambda item: item[0])
        canonical_query = urlencode(query_params, quote_via=quote, safe="-_.~")
        canonical_headers = f"host:{host.lower()}\n"
        canonical_request = "\n".join(
            (
                "GET",
                canonical_uri,
                canonical_query,
                canonical_headers,
                "host",
                "UNSIGNED-PAYLOAD",
            )
        )
        string_to_sign = "\n".join(
            (
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            )
        )
        signing_key = _sigv4_signing_key(self._secret_key, date_stamp, self._region, "s3")
        signature = hmac.new(
            signing_key, string_to_sign.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return (
            f"{self._endpoint.scheme}://{host}{canonical_uri}"
            f"?{canonical_query}&X-Amz-Signature={signature}"
        )

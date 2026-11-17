"""Application settings (pydantic-settings). Every value comes from the environment
(prefix ``NZT_``) or a local ``.env`` file; secrets are ``SecretStr`` so they are never
rendered in logs/reprs. Production refuses to start with insecure/missing values."""

from __future__ import annotations

import base64
import binascii
import ipaddress
import re
from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


SslMode = Literal["disable", "require", "verify-ca", "verify-full"]

_SEMVER = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}$")
_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


def _origin(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError(f"not an absolute http(s) URL: {url!r}")
    if parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise ValueError(f"must be an origin without path/query: {url!r}")
    return f"{parts.scheme}://{parts.netloc}".lower()


def _is_blank(value: object) -> bool:
    if isinstance(value, SecretStr):
        value = value.get_secret_value()
    return value is None or (isinstance(value, str) and not value.strip())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NZT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,  # "NZT_X=" means "use the default", never an empty secret
    )

    environment: Environment = Environment.DEVELOPMENT
    log_level: str = "INFO"

    # --- Public URLs (D-A2: .it domains, everything configurable) ---------------------
    api_public_base_url: str = "https://api.nztsolutions.it"
    portal_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["https://clienti.nztsolutions.it"]
    )
    storage_public_origin: str = "https://storage.nztsolutions.it"

    # --- Database ---------------------------------------------------------------------
    database_url: SecretStr = SecretStr(
        "postgresql+asyncpg://nzt_app:nzt_app_test@127.0.0.1:55432/nzt_test"
    )
    migrations_database_url: SecretStr | None = None
    database_sslmode: SslMode | None = None  # default: verify-full in prod, disable otherwise
    database_ssl_root_cert: str | None = None
    database_pool_size: int = Field(default=10, ge=1, le=100)
    database_max_overflow: int = Field(default=5, ge=0, le=100)

    # --- Redis ------------------------------------------------------------------------
    redis_url: SecretStr = SecretStr("redis://127.0.0.1:56379/0")

    # --- Access tokens (D-A4/D-A6) ------------------------------------------------------
    access_token_private_key_pem: SecretStr | None = None  # Ed25519 PKCS#8 PEM
    access_token_ttl_seconds: int = Field(default=600, ge=300, le=600)
    refresh_token_ttl_seconds: int = Field(default=604800, ge=3600, le=604800)

    # --- DPoP (D-A5) --------------------------------------------------------------------
    dpop_iat_leeway_seconds: int = Field(default=60, ge=5, le=300)

    # --- Passwords (D-A9) ---------------------------------------------------------------
    argon2_max_concurrency: int = Field(default=2, ge=1, le=32)
    # Max calls WAITING for an Argon2 slot; beyond it -> 503 + Retry-After (review L4).
    argon2_max_queue: int = Field(default=8, ge=0, le=1024)

    # --- Client IP / proxies (D-A10) ----------------------------------------------------
    trusted_proxy_cidrs: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Explicit opt-in for "no reverse proxy in front of the API": the socket peer is the
    # client. In production exactly one of trusted_proxy_cidrs / this flag must be set.
    direct_client_connections: bool = False

    # --- HTTP hardening ---------------------------------------------------------------
    max_request_body_bytes: int = Field(default=16_384, ge=1024, le=1_048_576)

    # --- Google OIDC (D-A11) ------------------------------------------------------------
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_redirect_uri: str | None = None  # default: <first portal origin>/auth/google/callback
    google_authorization_endpoint: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_token_endpoint: str = "https://oauth2.googleapis.com/token"  # noqa: S105
    google_jwks_uri: str = "https://www.googleapis.com/oauth2/v3/certs"
    google_issuers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["https://accounts.google.com", "accounts.google.com"]
    )
    google_http_timeout_seconds: float = Field(default=10.0, gt=0, le=30)
    oauth_state_key: SecretStr | None = None  # base64url 32 bytes (AES-256-GCM)

    # --- Object storage / launcher (D-A13) ----------------------------------------------
    storage_endpoint_url: str = "https://storage.nztsolutions.it"
    storage_region: str = "auto"
    storage_bucket: str = "nzt-binaries"
    storage_access_key_id: SecretStr | None = None
    storage_secret_access_key: SecretStr | None = None
    storage_addressing_style: Literal["path", "virtual"] = "path"
    launcher_version: str = "1.0.0"
    launcher_sha256: str = "0" * 64

    # ---------------------------------------------------------------------------------
    @field_validator("portal_origins", "trusted_proxy_cidrs", "google_issuers", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @field_validator("api_public_base_url", "storage_public_origin")
    @classmethod
    def _check_origin(cls, v: str) -> str:
        return _origin(v)

    @field_validator("portal_origins")
    @classmethod
    def _check_portals(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("at least one portal origin is required")
        return [_origin(o) for o in v]

    @field_validator("trusted_proxy_cidrs")
    @classmethod
    def _check_cidrs(cls, v: list[str]) -> list[str]:
        for cidr in v:
            ipaddress.ip_network(cidr, strict=False)
        return v

    @field_validator("launcher_version")
    @classmethod
    def _check_version(cls, v: str) -> str:
        if not _SEMVER.fullmatch(v):
            raise ValueError("launcher_version must be MAJOR.MINOR.PATCH")
        return v

    @field_validator("launcher_sha256")
    @classmethod
    def _check_sha(cls, v: str) -> str:
        v = v.lower()
        if not _SHA256_HEX.fullmatch(v):
            raise ValueError("launcher_sha256 must be 64 lowercase hex chars")
        return v

    @field_validator("oauth_state_key")
    @classmethod
    def _check_state_key(cls, v: SecretStr | None) -> SecretStr | None:
        if v is not None:
            try:
                raw = base64.urlsafe_b64decode(v.get_secret_value() + "==")
            except (binascii.Error, ValueError) as exc:
                raise ValueError("oauth_state_key must be base64url") from exc
            if len(raw) != 32:
                raise ValueError("oauth_state_key must decode to exactly 32 bytes")
        return v

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.environment != Environment.PRODUCTION:
            return self
        missing = [
            name
            for name in (
                "access_token_private_key_pem",
                "oauth_state_key",
                "google_client_id",
                "google_client_secret",
                "storage_access_key_id",
                "storage_secret_access_key",
            )
            if _is_blank(getattr(self, name))
        ]
        if missing:
            raise ValueError(f"production requires: {', '.join(missing)}")
        if self.launcher_sha256 == "0" * 64:
            raise ValueError("production requires NZT_LAUNCHER_SHA256")
        # Infrastructure endpoints must be configured explicitly: the built-in defaults
        # point at the local test services and must never be used in production.
        # NZT_MIGRATIONS_DATABASE_URL is deliberately NOT required (nor wanted) here: DDL
        # migrations run in a separate pipeline step and the API service must not hold the
        # migrator credentials; alembic/env.py requires it when migrations run.
        implicit = [
            env
            for name, env in (
                ("database_url", "NZT_DATABASE_URL"),
                ("redis_url", "NZT_REDIS_URL"),
            )
            if name not in self.model_fields_set or _is_blank(getattr(self, name))
        ]
        if implicit:
            raise ValueError(f"production requires explicit {', '.join(implicit)}")
        if self.effective_db_sslmode != "verify-full":
            raise ValueError("production requires NZT_DATABASE_SSLMODE=verify-full")
        if self.trusted_proxy_cidrs and self.direct_client_connections:
            raise ValueError(
                "production: set NZT_TRUSTED_PROXY_CIDRS or NZT_DIRECT_CLIENT_CONNECTIONS, not both"
            )
        if not self.trusted_proxy_cidrs and not self.direct_client_connections:
            raise ValueError(
                "production requires NZT_TRUSTED_PROXY_CIDRS (or the explicit opt-in "
                "NZT_DIRECT_CLIENT_CONNECTIONS=true when no reverse proxy is in front)"
            )
        urls = [self.api_public_base_url, self.storage_public_origin, *self.portal_origins]
        if any(not u.startswith("https://") for u in urls):
            raise ValueError("production public URLs must be https")
        storage = urlsplit(self.storage_endpoint_url)
        if storage.scheme != "https" or not storage.hostname:
            raise ValueError("production requires an https NZT_STORAGE_ENDPOINT_URL")
        return self

    # --- derived ------------------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment == Environment.PRODUCTION

    @property
    def effective_db_sslmode(self) -> SslMode:
        if self.database_sslmode is not None:
            return self.database_sslmode
        return "verify-full" if self.is_production else "disable"

    @property
    def effective_google_redirect_uri(self) -> str:
        return self.google_redirect_uri or f"{self.portal_origins[0]}/auth/google/callback"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

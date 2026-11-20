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
from urllib.parse import parse_qsl, urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


# Transactional email (email verification, AGGIUNTA). "resend" is the only production
# backend; "console" (logs the message), "file" (one JSON file per message) and "memory"
# (in-process outbox) are development/test-only and refused in production.
MailBackend = Literal["resend", "console", "file", "memory"]

_SEMVER = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}$")
_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
# MongoDB database names: no "/\\. \"$" and short (Atlas limit 38 bytes); we allow a safe subset.
_MONGO_DB_NAME = re.compile(r"^[A-Za-z0-9_-]{1,38}$")
_MONGO_SCHEMES = {"mongodb", "mongodb+srv"}
# URI options that weaken TLS: refused in production (equivalent of libpq "verify-full").
_MONGO_INSECURE_TLS_OPTIONS = {
    "tlsinsecure",
    "tlsallowinvalidcertificates",
    "tlsallowinvalidhostnames",
    "tlsdisableocspendpointcheck",
    "tlsdisablecertificaterevocationcheck",
    "ssl_cert_reqs",
}


def _origin(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError(f"not an absolute http(s) URL: {url!r}")
    if parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise ValueError(f"must be an origin without path/query: {url!r}")
    return f"{parts.scheme}://{parts.netloc}".lower()


def _mongo_uri_parts(uri: str) -> tuple[bool, dict[str, str]]:
    """(has_username, lower-cased query options) WITHOUT resolving DNS: pymongo's
    own parser performs the SRV lookup, which must never happen during config validation."""
    parts = urlsplit(uri)
    if parts.scheme not in _MONGO_SCHEMES:
        raise ValueError("NZT_MONGODB_URI must start with mongodb:// or mongodb+srv://")
    netloc = parts.netloc
    userinfo = netloc.rpartition("@")[0] if "@" in netloc else ""
    # The driver accepts both "&" and ";" as option separators.
    query = parts.query.replace(";", "&")
    options = {k.lower(): v.lower() for k, v in parse_qsl(query, keep_blank_values=True)}
    return bool(userinfo.partition(":")[0] and userinfo.partition(":")[2]), options


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
    # Admin dashboard origins (separate app/origin from the customer portal): CORS + CSP only.
    admin_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["https://admin.nztsolutions.it"]
    )
    storage_public_origin: str = "https://storage.nztsolutions.it"

    # --- MongoDB ----------------------------------------------------------------------
    # Runtime user: custom role limited to find/insert/update/remove on ONE database (no
    # createIndex/collMod/drop). The schema user (validators + indexes) is only used by
    # ``python -m app.schema`` through NZT_MONGODB_MIGRATIONS_URI, never by the API.
    mongodb_uri: SecretStr = SecretStr(
        "mongodb://nzt_app:nzt_app_test@127.0.0.1:57017/?authSource=nzt_test&directConnection=true"
    )
    mongodb_migrations_uri: SecretStr | None = None
    mongodb_database: str = "nzt_test"
    mongodb_tls: bool | None = None  # default: required in production, off otherwise
    mongodb_tls_ca_file: str | None = None  # CA bundle when the server CA is not a system CA
    mongodb_max_pool_size: int = Field(default=10, ge=1, le=100)
    # Client-side operation timeout (CSOT), same role as the old statement_timeout.
    mongodb_timeout_ms: int = Field(default=15_000, ge=1_000, le=60_000)
    mongodb_server_selection_timeout_ms: int = Field(default=5_000, ge=500, le=30_000)

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

    # --- Transactional email / email verification (AGGIUNTA) ---------------------------
    mail_backend: MailBackend = "console"
    resend_api_key: SecretStr | None = None
    mail_from: str | None = None  # e.g. "NZT Solutions <noreply@nztsolutions.it>"
    mail_file_dir: str | None = None  # only for mail_backend=file (development / E2E)
    mail_http_timeout_seconds: float = Field(default=10.0, gt=0, le=30)
    email_verification_ttl_seconds: int = Field(default=86_400, ge=3_600, le=172_800)

    # ---------------------------------------------------------------------------------
    @field_validator(
        "portal_origins", "admin_origins", "trusted_proxy_cidrs", "google_issuers", mode="before"
    )
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

    @field_validator("admin_origins")
    @classmethod
    def _check_admins(cls, v: list[str]) -> list[str]:
        return [_origin(o) for o in v]

    @field_validator("trusted_proxy_cidrs")
    @classmethod
    def _check_cidrs(cls, v: list[str]) -> list[str]:
        for cidr in v:
            ipaddress.ip_network(cidr, strict=False)
        return v

    @field_validator("mongodb_database")
    @classmethod
    def _check_mongo_db(cls, v: str) -> str:
        if not _MONGO_DB_NAME.fullmatch(v):
            raise ValueError("mongodb_database must match [A-Za-z0-9_-]{1,38}")
        return v

    @field_validator("mongodb_uri", "mongodb_migrations_uri")
    @classmethod
    def _check_mongo_uri(cls, v: SecretStr | None) -> SecretStr | None:
        if v is not None:
            _mongo_uri_parts(v.get_secret_value())
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

    @field_validator("mail_from")
    @classmethod
    def _check_mail_from(cls, v: str | None) -> str | None:
        if v is not None and (_CONTROL_CHARS.search(v) or "@" not in v or len(v) > 255):
            raise ValueError("mail_from must be 'Name <address>' or an address, one line")
        return v

    @field_validator("oauth_state_key")
    @classmethod
    def _check_state_key(cls, v: SecretStr | None) -> SecretStr | None:
        if v is not None:
            raw_str = v.get_secret_value()
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}={0,2}", raw_str):
                raise ValueError("oauth_state_key must be base64url of 32 bytes")
            try:
                raw = base64.urlsafe_b64decode(raw_str + "=" * (-len(raw_str) % 4))
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
        # NZT_MONGODB_MIGRATIONS_URI is deliberately NOT required (nor wanted) here: the
        # schema step (validators + indexes) runs separately and the API service must not
        # hold the schema user's credentials; app/schema.py requires it when it runs.
        implicit = [
            env
            for name, env in (
                ("mongodb_uri", "NZT_MONGODB_URI"),
                ("mongodb_database", "NZT_MONGODB_DATABASE"),
                ("redis_url", "NZT_REDIS_URL"),
            )
            if name not in self.model_fields_set or _is_blank(getattr(self, name))
        ]
        if implicit:
            raise ValueError(f"production requires explicit {', '.join(implicit)}")
        self._check_production_mongo_uri(self.mongodb_uri, "NZT_MONGODB_URI")
        if self.mongodb_migrations_uri is not None:  # only set in the schema step
            self._check_production_mongo_uri(
                self.mongodb_migrations_uri, "NZT_MONGODB_MIGRATIONS_URI"
            )
        if self.trusted_proxy_cidrs and self.direct_client_connections:
            raise ValueError(
                "production: set NZT_TRUSTED_PROXY_CIDRS or NZT_DIRECT_CLIENT_CONNECTIONS, not both"
            )
        if not self.trusted_proxy_cidrs and not self.direct_client_connections:
            raise ValueError(
                "production requires NZT_TRUSTED_PROXY_CIDRS (or the explicit opt-in "
                "NZT_DIRECT_CLIENT_CONNECTIONS=true when no reverse proxy is in front)"
            )
        urls = [
            self.api_public_base_url,
            self.storage_public_origin,
            *self.portal_origins,
            *self.admin_origins,
            self.effective_google_redirect_uri,
            self.google_authorization_endpoint,
            self.google_token_endpoint,
            self.google_jwks_uri,
        ]
        if any(not u.startswith("https://") for u in urls):
            raise ValueError("production public URLs must be https")
        redis_parts = urlsplit(self.redis_url.get_secret_value())
        if redis_parts.scheme not in {"redis", "rediss"} or not redis_parts.hostname:
            raise ValueError("production requires a valid redis:// or rediss:// NZT_REDIS_URL")
        if not redis_parts.password:
            raise ValueError("production requires a password in NZT_REDIS_URL")
        if (
            redis_parts.scheme != "rediss"
            and not redis_parts.hostname.endswith(".railway.internal")
        ):
            raise ValueError("production requires rediss:// for external NZT_REDIS_URL")
        storage = urlsplit(self.storage_endpoint_url)
        if storage.scheme != "https" or not storage.hostname:
            raise ValueError("production requires an https NZT_STORAGE_ENDPOINT_URL")
        return self

    def _check_production_mongo_uri(self, uri: SecretStr, env: str) -> None:
        """Production: authenticated, certificate- AND hostname-verified TLS only."""
        if not self.effective_mongodb_tls:
            raise ValueError("production requires NZT_MONGODB_TLS=true")
        has_user, options = _mongo_uri_parts(uri.get_secret_value())
        if not has_user:
            raise ValueError(f"production requires credentials in {env}")
        if any(options.get(o) == "false" for o in ("tls", "ssl")):
            raise ValueError(f"production refuses tls=false in {env}")
        weak = sorted(_MONGO_INSECURE_TLS_OPTIONS.intersection(options))
        if weak:
            raise ValueError(f"production refuses TLS-weakening options in {env}: {weak}")

    @model_validator(mode="after")
    def _mail_guards(self) -> Settings:
        if self.is_production and self.mail_backend != "resend":
            raise ValueError(
                "production requires NZT_MAIL_BACKEND=resend "
                "(console/file/memory mailers are development-only)"
            )
        if self.mail_backend == "resend":
            missing = [
                env
                for name, env in (
                    ("resend_api_key", "NZT_RESEND_API_KEY"),
                    ("mail_from", "NZT_MAIL_FROM"),
                )
                if _is_blank(getattr(self, name))
            ]
            if missing:
                raise ValueError(f"NZT_MAIL_BACKEND=resend requires {', '.join(missing)}")
        if self.mail_backend == "file" and _is_blank(self.mail_file_dir):
            raise ValueError("NZT_MAIL_BACKEND=file requires NZT_MAIL_FILE_DIR")
        return self

    # --- derived ------------------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment == Environment.PRODUCTION

    @property
    def effective_mongodb_tls(self) -> bool:
        if self.mongodb_tls is not None:
            return self.mongodb_tls
        return self.is_production

    @property
    def effective_google_redirect_uri(self) -> str:
        return self.google_redirect_uri or f"{self.portal_origins[0]}/auth/google/callback"

    @property
    def email_verification_page_url(self) -> str:
        """Portal page that consumes the token; the token travels in the URL FRAGMENT."""
        return f"{self.portal_origins[0]}/verifica-email"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

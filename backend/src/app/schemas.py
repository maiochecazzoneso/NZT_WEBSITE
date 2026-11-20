"""Request/response bodies - spec §8 contracts."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
)

from app.security.passwords import PASSWORD_MAX_LENGTH, password_policy_errors

EMAIL_MAX_LENGTH = 255


def normalize_email(value: str) -> str:
    return value.strip().lower()


def _normalize_before(value: object) -> object:
    return normalize_email(value) if isinstance(value, str) else value


# THE canonical email form, shared by local register/login AND Google sign-in (review I5):
# strip + lowercase, then email-validator (Unicode NFC, IDNA "xn--" domains converted to
# their Unicode form, syntax checks, no DNS), max 255 chars. The DB lookup key, the
# per-email rate-limit key and the stored users.email are all this exact string.
CanonicalEmail = Annotated[
    EmailStr, BeforeValidator(_normalize_before), Field(max_length=EMAIL_MAX_LENGTH)
]
_CANONICAL_EMAIL: TypeAdapter[str] = TypeAdapter(CanonicalEmail)


class InvalidEmailError(ValueError):
    pass


def canonical_email(value: str) -> str:
    """Canonicalise an email exactly like LoginRequest/RegisterRequest do."""
    try:
        return _CANONICAL_EMAIL.validate_python(value)
    except ValidationError as exc:
        raise InvalidEmailError("invalid email address") from exc


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=4096)


class LoginRequest(_Strict):
    email: CanonicalEmail = Field(examples=["user@domain.com"])
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class RegisterRequest(LoginRequest):
    password: str = Field(
        min_length=12, max_length=PASSWORD_MAX_LENGTH, examples=["SuperSecurePassword123!"]
    )

    @field_validator("password")
    @classmethod
    def _policy(cls, v: str) -> str:
        errors = password_policy_errors(v)
        if errors:
            raise ValueError("password " + "; ".join(errors))
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["DPoP"] = "DPoP"  # noqa: S105
    expires_in: int = Field(examples=[600])


class ErrorResponse(BaseModel):
    detail: str


class GoogleAuthorizeResponse(BaseModel):
    authorization_url: str


class GoogleCallbackRequest(_Strict):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=256)


class VerifyEmailRequest(_Strict):
    token: str = Field(min_length=1, max_length=128)


class MeResponse(BaseModel):
    email: str
    is_verified: bool


class DownloadResponse(BaseModel):
    download_url: str
    sha256: str
    version: str
    expires_in: int = Field(examples=[300])


class HealthResponse(BaseModel):
    status: Literal["ok"]

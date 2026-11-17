"""Request/response bodies - spec §8 contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.security.passwords import PASSWORD_MAX_LENGTH, password_policy_errors


def normalize_email(value: str) -> str:
    return value.strip().lower()


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=4096)


class LoginRequest(_Strict):
    email: EmailStr = Field(max_length=255, examples=["user@domain.com"])
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)

    @field_validator("email", mode="before")
    @classmethod
    def _norm(cls, v: object) -> object:
        return normalize_email(v) if isinstance(v, str) else v


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


class DownloadResponse(BaseModel):
    download_url: str
    sha256: str
    version: str
    expires_in: int = Field(examples=[300])


class HealthResponse(BaseModel):
    status: Literal["ok"]

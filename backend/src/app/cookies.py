"""Hardened cookies (D-A1). ``__Secure-`` prefix (not ``__Host-``: browsers require
Path=/ for ``__Host-`` but the spec mandates Path=/api/v1/auth). No Domain attribute =>
host-only cookie on the API host. The header is rendered explicitly so the attribute
set is exactly the spec's (§6.2, §5.2)."""

from __future__ import annotations

import re
from typing import Final, Literal

from starlette.responses import Response

REFRESH_COOKIE: Final = "__Secure-refresh-token"
OAUTH_STATE_COOKIE: Final = "__Secure-oauth-state"
AUTH_COOKIE_PATH: Final = "/api/v1/auth"
ADMIN_REFRESH_COOKIE: Final = "__Secure-admin-refresh-token"
ADMIN_COOKIE_PATH: Final = "/api/v1/admin/auth"
_EPOCH: Final = "Thu, 01 Jan 1970 00:00:00 GMT"
_SAFE_VALUE = re.compile(r"^[A-Za-z0-9_\-]*$")


def _render(
    name: str,
    value: str,
    *,
    max_age: int,
    samesite: Literal["Strict", "Lax"],
    path: str = AUTH_COOKIE_PATH,
) -> str:
    if not _SAFE_VALUE.fullmatch(value):
        raise ValueError("cookie value must be base64url")
    parts = [
        f"{name}={value}",
        "HttpOnly",
        "Secure",
        f"SameSite={samesite}",
        f"Path={path}",
        f"Max-Age={max_age}",
    ]
    if max_age == 0:
        parts.append(f"Expires={_EPOCH}")
    return "; ".join(parts)


def set_refresh_cookie(response: Response, raw: str, max_age: int) -> None:
    response.headers.append(
        "set-cookie", _render(REFRESH_COOKIE, raw, max_age=max_age, samesite="Strict")
    )


def clear_refresh_cookie(response: Response) -> None:
    response.headers.append("set-cookie", _render(REFRESH_COOKIE, "", max_age=0, samesite="Strict"))


def set_oauth_state_cookie(response: Response, sealed: str, max_age: int) -> None:
    response.headers.append(
        "set-cookie", _render(OAUTH_STATE_COOKIE, sealed, max_age=max_age, samesite="Lax")
    )


def clear_oauth_state_cookie(response: Response) -> None:
    response.headers.append(
        "set-cookie", _render(OAUTH_STATE_COOKIE, "", max_age=0, samesite="Lax")
    )


def set_admin_refresh_cookie(response: Response, raw: str, max_age: int) -> None:
    """Separate cookie + path for the admin dashboard: it never collides with the customer one."""
    response.headers.append(
        "set-cookie",
        _render(
            ADMIN_REFRESH_COOKIE, raw, max_age=max_age, samesite="Strict", path=ADMIN_COOKIE_PATH
        ),
    )


def clear_admin_refresh_cookie(response: Response) -> None:
    response.headers.append(
        "set-cookie",
        _render(ADMIN_REFRESH_COOKIE, "", max_age=0, samesite="Strict", path=ADMIN_COOKIE_PATH),
    )

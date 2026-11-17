"""Register / login / refresh (RTR + reuse detection) / logout, cookies (spec §6, §8)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx
import jwt
from fastapi import FastAPI

from tests.conftest import (
    ClientFactory,
    create_user,
    download,
    grant,
    login,
    refresh,
    refresh_cookie_of,
    register,
)
from tests.helpers import API_BASE, DPoPKey


def _decode(token: str) -> dict[str, object]:
    return jwt.decode(token, options={"verify_signature": False})


async def test_register_happy_path(client: httpx.AsyncClient, migrator_conn: asyncpg.Connection):
    key = DPoPKey()
    resp = await register(client, key, email="  New.User@Domain.COM ")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == {"access_token", "token_type", "expires_in"}
    assert body["token_type"] == "DPoP"
    assert body["expires_in"] == 600

    header = jwt.get_unverified_header(body["access_token"])
    assert header["alg"] == "EdDSA"
    assert header["typ"] == "at+jwt"
    assert header["kid"]
    claims = _decode(body["access_token"])
    # iat_ms: revocation-ordering instant (review L3), see services/sessions.py.
    assert set(claims) == {"sub", "iss", "exp", "jti", "cnf", "iat", "iat_ms"}
    assert claims["iss"] == API_BASE
    assert claims["cnf"] == {"jkt": key.thumbprint}
    assert int(claims["exp"]) - int(claims["iat"]) == 600  # type: ignore[call-overload]

    row = await migrator_conn.fetchrow("SELECT * FROM users")
    assert row["email"] == "new.user@domain.com"
    assert row["is_verified"] is False
    assert row["password_hash"].startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    ident = await migrator_conn.fetchrow("SELECT * FROM auth_identities")
    assert (ident["provider"], ident["provider_user_id"]) == ("local", "new.user@domain.com")
    fam = await migrator_conn.fetchrow("SELECT * FROM refresh_token_families")
    assert fam["dpop_jkt"] == key.thumbprint
    tok = await migrator_conn.fetchrow("SELECT * FROM refresh_tokens")
    raw = refresh_cookie_of(resp)
    import hashlib

    assert tok["token_hash"] == hashlib.sha256(raw.encode()).hexdigest()
    assert raw not in tok["token_hash"]


async def test_cookie_attributes_exact(client: httpx.AsyncClient):
    resp = await register(client, DPoPKey())
    cookies = resp.headers.get_list("set-cookie")
    assert len(cookies) == 1
    raw = refresh_cookie_of(resp)
    assert len(raw) == 43
    assert cookies[0] == (
        f"__Secure-refresh-token={raw}; HttpOnly; Secure; SameSite=Strict; "
        "Path=/api/v1/auth; Max-Age=604800"
    )
    assert "domain" not in cookies[0].lower()
    assert "__Host-" not in cookies[0]


async def test_register_weak_passwords_rejected(client_factory: ClientFactory):
    for i, pwd in enumerate(["short1!", "NoDigitsHere!!!!", "NoSpecials12345", "123456789012!"]):
        c = client_factory(ip=f"198.51.100.{i + 1}")
        resp = await register(c, DPoPKey(), email=f"weak{i}@domain.com", password=pwd)
        assert resp.status_code == 422, pwd
        assert pwd not in resp.text  # input never echoed


async def test_register_existing_email_generic_failure(
    client_factory: ClientFactory, migrator_conn: asyncpg.Connection
):
    assert (await register(client_factory("198.51.100.1"), DPoPKey())).status_code == 201
    resp = await register(client_factory("198.51.100.2"), DPoPKey(), email="USER@domain.com")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Registration failed"}
    assert "set-cookie" not in resp.headers
    assert await migrator_conn.fetchval("SELECT count(*) FROM users") == 1


async def test_register_requires_dpop(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "SuperSecurePassword123!"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid DPoP proof"}
    assert resp.headers["www-authenticate"].startswith('DPoP error="invalid_dpop_proof"')


async def test_login_happy_path_and_wrong_password(client: httpx.AsyncClient):
    key = DPoPKey()
    await register(client, key)
    ok = await login(client, key)
    assert ok.status_code == 200
    assert ok.json()["token_type"] == "DPoP"
    assert refresh_cookie_of(ok)
    bad = await login(client, key, password="WrongPassword123!!")
    assert bad.status_code == 401
    assert bad.json() == {"detail": "Invalid email or password"}
    assert "set-cookie" not in bad.headers


async def test_login_unknown_user_runs_dummy_verify(app: FastAPI, client: httpx.AsyncClient):
    passwords = app.state.services.passwords
    before = passwords.dummy_verifications
    resp = await login(client, DPoPKey(), email="nobody@domain.com")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid email or password"}
    assert passwords.dummy_verifications == before + 1


async def test_login_google_only_and_inactive_users_dummy_verify(
    app: FastAPI, client_factory: ClientFactory, migrator_conn: asyncpg.Connection
):
    passwords = app.state.services.passwords
    await create_user(migrator_conn, "google-only@domain.com", password_hash=None)
    real_hash = await passwords.hash("SuperSecurePassword123!")
    await create_user(
        migrator_conn, "inactive@domain.com", password_hash=real_hash, is_active=False
    )
    before = passwords.dummy_verifications
    r1 = await login(client_factory("198.51.100.7"), DPoPKey(), email="google-only@domain.com")
    r2 = await login(client_factory("198.51.100.8"), DPoPKey(), email="inactive@domain.com")
    assert r1.status_code == r2.status_code == 401
    assert r1.json() == r2.json() == {"detail": "Invalid email or password"}
    assert passwords.dummy_verifications == before + 2


async def test_refresh_rotation(client: httpx.AsyncClient, migrator_conn: asyncpg.Connection):
    key = DPoPKey()
    first = refresh_cookie_of(await register(client, key))
    r1 = await refresh(client, key, cookie=first)
    assert r1.status_code == 200, r1.text
    second = refresh_cookie_of(r1)
    assert second != first
    assert _decode(r1.json()["access_token"])["cnf"] == {"jkt": key.thumbprint}
    r2 = await refresh(client, key, cookie=second)
    assert r2.status_code == 200
    rows = await migrator_conn.fetch("SELECT is_used FROM refresh_tokens ORDER BY created_at")
    assert [r["is_used"] for r in rows] == [True, True, False]
    assert await migrator_conn.fetchval("SELECT count(DISTINCT family_id) FROM refresh_tokens") == 1


async def test_refresh_missing_cookie(client: httpx.AsyncClient):
    resp = await client.post(
        "/api/v1/auth/refresh", headers={"DPoP": DPoPKey().proof("POST", "/api/v1/auth/refresh")}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Missing refresh token"}


async def test_reuse_detection_revokes_all_and_kills_access_tokens(
    app: FastAPI, client_factory: ClientFactory, migrator_conn: asyncpg.Connection
):
    key = DPoPKey()
    c = client_factory()
    reg = await register(c, key)
    first = refresh_cookie_of(reg)
    # A second, independent session (other device) of the same user.
    other_key = DPoPKey()
    other = await login(client_factory("198.51.100.99"), other_key)
    other_token = other.json()["access_token"]
    user_id = await migrator_conn.fetchval("SELECT id FROM users")
    await grant(migrator_conn, user_id)
    assert (await download(c, other_key, other_token)).status_code == 200

    rotated = await refresh(c, key, cookie=first)
    assert rotated.status_code == 200
    new_cookie = refresh_cookie_of(rotated)

    replay = await refresh(c, key, cookie=first)  # stolen, already-used token
    assert replay.status_code == 401
    assert replay.json() == {"detail": "Refresh token reuse detected"}
    cleared = replay.headers.get_list("set-cookie")
    assert any(h.startswith("__Secure-refresh-token=;") and "Max-Age=0" in h for h in cleared)

    fams = await migrator_conn.fetch(
        "SELECT is_revoked, revoked_reason FROM refresh_token_families"
    )
    assert len(fams) == 2
    assert all(f["is_revoked"] and f["revoked_reason"] == "reuse_detected" for f in fams)
    # Legit rotated token is dead too, and the other device's access token is killed now.
    assert (await refresh(c, key, cookie=new_cookie)).status_code == 401
    killed = await download(c, other_key, other_token)
    assert killed.status_code == 401
    assert 'error="invalid_token"' in killed.headers["www-authenticate"]


async def test_concurrent_double_refresh_exactly_one_wins(
    client_factory: ClientFactory, migrator_conn: asyncpg.Connection
):
    key = DPoPKey()
    c = client_factory()
    raw = refresh_cookie_of(await register(c, key))
    c1, c2 = client_factory(), client_factory()
    results = await asyncio.gather(refresh(c1, key, cookie=raw), refresh(c2, key, cookie=raw))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 401]
    loser = next(r for r in results if r.status_code == 401)
    assert loser.json() == {"detail": "Refresh token reuse detected"}
    # Documented design (D-A8): the loser is treated as reuse => family revoked.
    assert await migrator_conn.fetchval("SELECT bool_and(is_revoked) FROM refresh_token_families")
    assert await migrator_conn.fetchval("SELECT count(*) FROM refresh_tokens") == 2


async def test_expired_refresh_is_not_reuse(
    client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    key = DPoPKey()
    raw = refresh_cookie_of(await register(client, key))
    await migrator_conn.execute(
        "UPDATE refresh_tokens SET expires_at = $1", datetime.now(UTC) - timedelta(seconds=1)
    )
    resp = await refresh(client, key, cookie=raw)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid refresh token"}
    fam = await migrator_conn.fetchrow("SELECT is_revoked FROM refresh_token_families")
    assert fam["is_revoked"] is False
    assert await migrator_conn.fetchval("SELECT is_used FROM refresh_tokens") is False


async def test_refresh_with_wrong_dpop_key(
    client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    key = DPoPKey()
    raw = refresh_cookie_of(await register(client, key))
    resp = await refresh(client, DPoPKey(), cookie=raw)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "DPoP key does not match refresh token binding"}
    assert 'error="invalid_dpop_proof"' in resp.headers["www-authenticate"]
    # Token not consumed: the legitimate holder can still rotate.
    assert await migrator_conn.fetchval("SELECT is_used FROM refresh_tokens") is False
    assert (await refresh(client, key, cookie=raw)).status_code == 200


async def test_refresh_garbage_cookie(client: httpx.AsyncClient):
    for value in ["x", "A" * 43, "%00%01"]:
        resp = await refresh(client, DPoPKey(), cookie=value)
        assert resp.status_code == 401
        assert resp.json() == {"detail": "Invalid refresh token"}


async def test_logout(client: httpx.AsyncClient, migrator_conn: asyncpg.Connection):
    key = DPoPKey()
    reg = await register(client, key)
    raw = refresh_cookie_of(reg)
    token = reg.json()["access_token"]
    user_id = await migrator_conn.fetchval("SELECT id FROM users")
    await grant(migrator_conn, user_id)

    # Wrong key cannot log the session out.
    bad = await client.post(
        "/api/v1/auth/logout",
        headers={
            "DPoP": DPoPKey().proof("POST", "/api/v1/auth/logout"),
            "Cookie": f"__Secure-refresh-token={raw}",
        },
    )
    assert bad.status_code == 401

    client.cookies.clear()
    resp = await client.post(
        "/api/v1/auth/logout",
        headers={
            "DPoP": key.proof("POST", "/api/v1/auth/logout"),
            "Cookie": f"__Secure-refresh-token={raw}",
        },
    )
    assert resp.status_code == 204
    assert resp.content == b""
    assert resp.headers.get_list("set-cookie") == [
        "__Secure-refresh-token=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; "
        "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    ]
    fam = await migrator_conn.fetchrow(
        "SELECT is_revoked, revoked_reason FROM refresh_token_families"
    )
    assert (fam["is_revoked"], fam["revoked_reason"]) == (True, "logout")
    assert (await refresh(client, key, cookie=raw)).status_code == 401
    # Access tokens bound to the logged-out key are rejected immediately.
    assert (await download(client, key, token)).status_code == 401


async def test_logout_requires_cookie_and_dpop(client: httpx.AsyncClient):
    no_cookie = await client.post(
        "/api/v1/auth/logout", headers={"DPoP": DPoPKey().proof("POST", "/api/v1/auth/logout")}
    )
    assert no_cookie.status_code == 401
    no_dpop = await client.post(
        "/api/v1/auth/logout", headers={"Cookie": "__Secure-refresh-token=" + "a" * 43}
    )
    assert no_dpop.status_code == 401

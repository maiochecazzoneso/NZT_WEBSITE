"""Admin dashboard login is separate from the customer login (own endpoints + own cookie)."""

from __future__ import annotations

import httpx

from app.db import Collections
from app.security.passwords import PasswordService
from tests.conftest import create_user, login
from tests.helpers import STRONG_PASSWORD, DPoPKey

ADMIN = "boss@domain.com"
CUSTOMER = "user@domain.com"
COOKIE = "__Secure-admin-refresh-token"


async def _seed(db: Collections) -> None:
    pw_hash = await PasswordService(max_concurrency=1).hash(STRONG_PASSWORD)
    await create_user(db, ADMIN, password_hash=pw_hash, is_verified=True, role="admin")
    await create_user(db, CUSTOMER, password_hash=pw_hash, is_verified=True)


async def admin_login(
    client: httpx.AsyncClient, key: DPoPKey, email: str, password: str = STRONG_PASSWORD
) -> httpx.Response:
    path = "/api/v1/admin/auth/login"
    return await client.post(
        path,
        json={"email": email, "password": password},
        headers={"DPoP": key.proof("POST", path)},
    )


def _cookie(resp: httpx.Response) -> str:
    for header in resp.headers.get_list("set-cookie"):
        if header.startswith(f"{COOKIE}="):
            return header
    raise AssertionError("no admin cookie")


async def _me(client: httpx.AsyncClient, key: DPoPKey, token: str) -> httpx.Response:
    path = "/api/v1/admin/me"
    return await client.get(
        path,
        headers={
            "Authorization": f"DPoP {token}",
            "DPoP": key.proof("GET", path, access_token=token),
        },
    )


async def test_admin_login_and_me(client: httpx.AsyncClient, mongo: Collections):
    await _seed(mongo)
    key = DPoPKey()
    resp = await admin_login(client, key, ADMIN)
    assert resp.status_code == 200, resp.text
    cookie = _cookie(resp)
    assert "Path=/api/v1/admin/auth" in cookie
    for attr in ("HttpOnly", "Secure", "SameSite=Strict"):
        assert attr in cookie
    me = await _me(client, key, resp.json()["access_token"])
    assert me.status_code == 200
    assert me.json() == {"email": ADMIN}


async def test_customer_cannot_use_admin_login(client: httpx.AsyncClient, mongo: Collections):
    await _seed(mongo)
    resp = await admin_login(client, DPoPKey(), CUSTOMER)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid email or password"}
    assert not [h for h in resp.headers.get_list("set-cookie") if h.startswith(COOKIE)]


async def test_wrong_password_same_message(client: httpx.AsyncClient, mongo: Collections):
    await _seed(mongo)
    resp = await admin_login(client, DPoPKey(), ADMIN, "wrong-password")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid email or password"}


async def test_customer_token_is_rejected_on_admin_routes(
    client: httpx.AsyncClient, mongo: Collections
):
    await _seed(mongo)
    key = DPoPKey()
    token = (await login(client, key, CUSTOMER)).json()["access_token"]
    assert (await _me(client, key, token)).status_code == 403


async def test_admin_can_also_log_in_as_customer_but_cookies_do_not_mix(
    client: httpx.AsyncClient, mongo: Collections
):
    await _seed(mongo)
    key = DPoPKey()
    admin = await admin_login(client, key, ADMIN)
    customer = await login(client, DPoPKey(), ADMIN)  # same account, customer portal entrance
    assert customer.status_code == 200
    assert any(
        h.startswith("__Secure-refresh-token=") for h in customer.headers.get_list("set-cookie")
    )
    assert not any(h.startswith(COOKIE) for h in customer.headers.get_list("set-cookie"))
    assert "Path=/api/v1/auth;" in customer.headers.get_list("set-cookie")[0] + ";"
    assert admin.status_code == 200


async def test_demoted_admin_loses_access_immediately(
    client: httpx.AsyncClient, mongo: Collections
):
    await _seed(mongo)
    key = DPoPKey()
    token = (await admin_login(client, key, ADMIN)).json()["access_token"]
    await mongo.users.update_one({"email": ADMIN}, {"$set": {"role": "customer"}})
    assert (await _me(client, key, token)).status_code == 403


async def test_admin_refresh_and_logout(client: httpx.AsyncClient, mongo: Collections):
    await _seed(mongo)
    key = DPoPKey()
    first = await admin_login(client, key, ADMIN)
    raw = _cookie(first).split(";", 1)[0].split("=", 1)[1]
    path = "/api/v1/admin/auth/refresh"
    client.cookies.clear()
    ref = await client.post(
        path, headers={"DPoP": key.proof("POST", path), "Cookie": f"{COOKIE}={raw}"}
    )
    assert ref.status_code == 200, ref.text
    new_raw = _cookie(ref).split(";", 1)[0].split("=", 1)[1]
    assert new_raw != raw
    out = "/api/v1/admin/auth/logout"
    resp = await client.post(
        out, headers={"DPoP": key.proof("POST", out), "Cookie": f"{COOKIE}={new_raw}"}
    )
    assert resp.status_code == 204
    again = await client.post(
        path, headers={"DPoP": key.proof("POST", path), "Cookie": f"{COOKIE}={new_raw}"}
    )
    assert again.status_code == 401


async def test_demoted_admin_cannot_refresh_admin_session(
    client: httpx.AsyncClient, mongo: Collections
):
    await _seed(mongo)
    key = DPoPKey()
    raw = _cookie(await admin_login(client, key, ADMIN)).split(";", 1)[0].split("=", 1)[1]
    await mongo.users.update_one({"email": ADMIN}, {"$set": {"role": "customer"}})
    path = "/api/v1/admin/auth/refresh"
    client.cookies.clear()
    resp = await client.post(
        path, headers={"DPoP": key.proof("POST", path), "Cookie": f"{COOKIE}={raw}"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid refresh token"}
    fam = await mongo.families.find_one({})
    assert fam is not None
    assert (fam["isRevoked"], fam["revokedReason"]) == (True, "user_not_allowed")

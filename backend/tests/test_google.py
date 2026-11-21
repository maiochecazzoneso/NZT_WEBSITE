"""Google OIDC code flow + PKCE against a local fake IdP (spec §5, §8.4, D-A11)."""

from __future__ import annotations

import hashlib
import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from fastapi import FastAPI

from app.db import Collections
from tests.conftest import create_user, one
from tests.helpers import GOOGLE_CLIENT_ID, PORTAL_ORIGIN, DPoPKey, FakeGoogle, b64url

CALLBACK = "/api/v1/auth/google/callback"


async def _authorize(client: httpx.AsyncClient) -> tuple[httpx.Response, dict[str, str]]:
    resp = await client.get("/api/v1/auth/google/authorize")
    assert resp.status_code == 200, resp.text
    url = resp.json()["authorization_url"]
    params = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    return resp, params


async def _callback(
    client: httpx.AsyncClient,
    key: DPoPKey,
    *,
    code: str,
    state: str,
    state_cookie: str | None,
) -> httpx.Response:
    client.cookies.clear()
    headers = {"DPoP": key.proof("POST", CALLBACK)}
    if state_cookie is not None:
        headers["Cookie"] = f"__Secure-oauth-state={state_cookie}"
    return await client.post(CALLBACK, json={"code": code, "state": state}, headers=headers)


def _state_cookie(resp: httpx.Response) -> str:
    for h in resp.headers.get_list("set-cookie"):
        if h.startswith("__Secure-oauth-state="):
            return h.split(";", 1)[0].split("=", 1)[1]
    raise AssertionError("no state cookie")


async def _flow(
    client: httpx.AsyncClient,
    fake: FakeGoogle,
    claims: dict[str, Any],
    *,
    tamper_state: bool = False,
    nonce_override: str | None = None,
) -> httpx.Response:
    auth, params = await _authorize(client)
    claims = {"nonce": nonce_override or params["nonce"], **claims}
    fake.register_code("code-123", code_challenge=params["code_challenge"], claims=claims)
    state = params["state"] + ("x" if tamper_state else "")
    return await _callback(
        client, DPoPKey(), code="code-123", state=state, state_cookie=_state_cookie(auth)
    )


async def test_authorize_url_and_state_cookie(client: httpx.AsyncClient):
    resp, params = await _authorize(client)
    url = resp.json()["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert params["client_id"] == GOOGLE_CLIENT_ID
    assert params["scope"] == "openid email profile"
    assert params["response_type"] == "code"
    assert params["code_challenge_method"] == "S256"
    assert len(params["code_challenge"]) == 43
    assert len(params["state"]) >= 43
    assert params["redirect_uri"] == f"{PORTAL_ORIGIN}/auth/google/callback"
    assert params["nonce"]
    cookies = resp.headers.get_list("set-cookie")
    assert len(cookies) == 1
    sealed = _state_cookie(resp)
    assert cookies[0] == (
        f"__Secure-oauth-state={sealed}; HttpOnly; Secure; SameSite=Lax; "
        "Path=/api/v1/auth/google/callback; Max-Age=300"
    )
    # Cookie is encrypted: neither the state nor the verifier is visible.
    assert params["state"] not in sealed


async def test_new_user_created_verified(
    client: httpx.AsyncClient, fake_google: FakeGoogle, mongo: Collections
):
    resp = await _flow(
        client, fake_google, {"sub": "g-1", "email": "New@Gmail.com", "email_verified": True}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "DPoP"
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert "jkt" in claims["cnf"]
    user = await one(mongo.users)
    assert user["email"] == "new@gmail.com"
    assert user["isVerified"] is True
    assert user["passwordHash"] is None
    assert [(i["provider"], i["providerUserId"]) for i in user["identities"]] == [("google", "g-1")]
    set_cookies = resp.headers.get_list("set-cookie")
    assert any(c.startswith("__Secure-refresh-token=") for c in set_cookies)
    assert any(c.startswith("__Secure-oauth-state=;") and "Max-Age=0" in c for c in set_cookies)
    # PKCE: the verifier sent to the token endpoint hashes to the challenge.
    sent = fake_google.token_requests[-1]
    assert sent["redirect_uri"] == f"{PORTAL_ORIGIN}/auth/google/callback"
    assert 43 <= len(sent["code_verifier"]) <= 128


async def test_existing_verified_account_is_linked(
    client: httpx.AsyncClient, fake_google: FakeGoogle, mongo: Collections
):
    user_id = await create_user(mongo, "known@domain.com", is_verified=True)
    resp = await _flow(
        client, fake_google, {"sub": "g-2", "email": "known@domain.com", "email_verified": True}
    )
    assert resp.status_code == 200
    user = await one(mongo.users)
    assert user["_id"] == user_id
    assert [i["provider"] for i in user["identities"]] == ["google"]
    # Second login with the same Google sub reuses the link.
    again = await _flow(
        client, fake_google, {"sub": "g-2", "email": "known@domain.com", "email_verified": True}
    )
    assert again.status_code == 200
    assert len((await one(mongo.users))["identities"]) == 1


async def test_unverified_local_account_taken_over(
    client: httpx.AsyncClient, fake_google: FakeGoogle, mongo: Collections
):
    """DEVIATION from spec §5.3 (was: 403): a verified Google identity takes control of an
    UNVERIFIED local account (pre-hijacking fix). Full scenario with an attacker holding
    live sessions: tests/test_email_verification.py::test_prehijack_google_takeover_*."""
    user_id = await create_user(
        mongo, "victim@domain.com", password_hash="x", is_verified=False, local_identity=True
    )
    resp = await _flow(
        client, fake_google, {"sub": "g-3", "email": "victim@domain.com", "email_verified": True}
    )
    assert resp.status_code == 200, resp.text
    user = await one(mongo.users)
    assert user["_id"] == user_id
    assert user["isVerified"] is True
    assert user["passwordHash"] is None
    assert [(i["provider"], i["providerUserId"]) for i in user["identities"]] == [("google", "g-3")]


async def test_state_mismatch_400(client: httpx.AsyncClient, fake_google: FakeGoogle):
    resp = await _flow(
        client,
        fake_google,
        {"sub": "g-4", "email": "a@gmail.com", "email_verified": True},
        tamper_state=True,
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Invalid OAuth state"}
    assert fake_google.token_requests == []  # never reached the IdP


async def test_missing_or_forged_state_cookie_400(client: httpx.AsyncClient):
    _, params = await _authorize(client)
    r1 = await _callback(client, DPoPKey(), code="c", state=params["state"], state_cookie=None)
    assert r1.status_code == 400
    r2 = await _callback(
        client, DPoPKey(), code="c", state=params["state"], state_cookie=b64url(b"x" * 64)
    )
    assert r2.status_code == 400


async def test_bad_nonce_rejected(client: httpx.AsyncClient, fake_google: FakeGoogle):
    resp = await _flow(
        client,
        fake_google,
        {"sub": "g-5", "email": "n@gmail.com", "email_verified": True},
        nonce_override="attacker-nonce",
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Invalid id_token nonce"}


async def test_email_not_verified_rejected(
    client: httpx.AsyncClient, fake_google: FakeGoogle, mongo: Collections
):
    resp = await _flow(
        client, fake_google, {"sub": "g-6", "email": "u@gmail.com", "email_verified": False}
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Google account email is not verified"}
    assert await mongo.users.count_documents({}) == 0


async def test_wrong_audience_and_issuer_rejected(
    client: httpx.AsyncClient, fake_google: FakeGoogle
):
    r1 = await _flow(
        client,
        fake_google,
        {"sub": "g-7", "email": "a@gmail.com", "email_verified": True, "aud": "other-client"},
    )
    assert r1.status_code == 400
    assert r1.json() == {"detail": "Invalid id_token"}
    r2 = await _flow(
        client,
        fake_google,
        {"sub": "g-7", "email": "a@gmail.com", "email_verified": True, "iss": "https://evil"},
    )
    assert r2.status_code == 400


async def test_expired_id_token_rejected(client: httpx.AsyncClient, fake_google: FakeGoogle):
    past = int(time.time()) - 3600
    resp = await _flow(
        client,
        fake_google,
        {
            "sub": "g-8",
            "email": "a@gmail.com",
            "email_verified": True,
            "iat": past,
            "exp": past + 60,
        },
    )
    assert resp.status_code == 400


async def test_pkce_verifier_mismatch_rejected_by_idp(
    client: httpx.AsyncClient, fake_google: FakeGoogle
):
    auth, params = await _authorize(client)
    wrong_challenge = b64url(hashlib.sha256(b"something-else").digest())
    fake_google.register_code(
        "code-x",
        code_challenge=wrong_challenge,
        claims={
            "sub": "g",
            "email": "a@gmail.com",
            "email_verified": True,
            "nonce": params["nonce"],
        },
    )
    resp = await _callback(
        client, DPoPKey(), code="code-x", state=params["state"], state_cookie=_state_cookie(auth)
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Authorization code exchange failed"}


async def test_callback_requires_dpop(client: httpx.AsyncClient):
    auth, params = await _authorize(client)
    client.cookies.clear()
    resp = await client.post(
        CALLBACK,
        json={"code": "c", "state": params["state"]},
        headers={"Cookie": f"__Secure-oauth-state={_state_cookie(auth)}"},
    )
    assert resp.status_code == 401


async def test_google_not_configured_503(app: FastAPI, client: httpx.AsyncClient):
    app.state.services.settings.google_client_id = None
    resp = await client.get("/api/v1/auth/google/authorize")
    assert resp.status_code == 503

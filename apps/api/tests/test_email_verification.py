"""Email verification + Google takeover of unverified local accounts (AGGIUNTA; closes
review M2 / residual risk R-2, account pre-hijacking).

Module-level imports use only pre-existing helpers so that the pre-hijacking scenario
(test_prehijack_google_takeover_kills_attacker) can be run unchanged against the code
before this change, where it fails (Google sign-in answered 403)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from typing import Any

import asyncpg
import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from tests.conftest import (
    ClientFactory,
    download,
    grant,
    login,
    make_settings,
    refresh,
    refresh_cookie_of,
    register,
)
from tests.helpers import PORTAL_ORIGIN, STRONG_PASSWORD, DPoPKey, FakeGoogle
from tests.test_google import _flow

VERIFY = "/api/v1/auth/verify-email"
RESEND = "/api/v1/auth/resend-verification"
ME = "/api/v1/auth/me"
VICTIM = "victim@company.com"
ATTACKER_PASSWORD = "AttackerPassword123!x"
GENERIC_400 = {"detail": "Invalid or expired verification token"}
_LINK_RE = re.compile(r"(\S*/verifica-email\S*)")
_TOKEN_RE = re.compile(r"/verifica-email#token=([A-Za-z0-9_-]{43})(?:\s|$)")


def outbox(app: FastAPI) -> list[Any]:
    from app.services.mailer import MemoryMailer

    mailer = app.state.services.mailer
    assert isinstance(mailer, MemoryMailer)
    return mailer.outbox


def token_of(message: Any) -> str:
    match = _TOKEN_RE.search(message.text)
    assert match, message.text
    return match.group(1)


async def verify(client: httpx.AsyncClient, token: str) -> httpx.Response:
    return await client.post(VERIFY, json={"token": token})


async def authed(
    client: httpx.AsyncClient, key: DPoPKey, method: str, path: str, token: str
) -> httpx.Response:
    return await client.request(
        method,
        path,
        headers={
            "Authorization": f"DPoP {token}",
            "DPoP": key.proof(method, path, access_token=token),
        },
    )


async def _registered(client: httpx.AsyncClient, email: str = "user@domain.com") -> tuple:
    key = DPoPKey()
    resp = await register(client, key, email=email)
    assert resp.status_code == 201, resp.text
    return key, resp.json()["access_token"], refresh_cookie_of(resp)


# --- registration sends the mail --------------------------------------------------------
async def test_registration_sends_exactly_one_mail_with_fragment_link(
    app: FastAPI, client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    await _registered(client, email="  New.User@Domain.COM ")
    sent = outbox(app)
    assert len(sent) == 1
    msg = sent[0]
    assert msg.to == "new.user@domain.com"
    assert msg.subject == "Conferma il tuo indirizzo email - Area Clienti NZT Solutions"
    links = _LINK_RE.findall(msg.text)
    assert len(links) == 1
    link = links[0]
    assert link.startswith(f"{PORTAL_ORIGIN}/verifica-email#token=")
    assert "?" not in link  # token in the FRAGMENT, never in the query string
    assert "Se non hai creato tu questo account ignora questa email" in msg.text
    assert "24 ore" in msg.text
    raw = token_of(msg)
    rows = await migrator_conn.fetch("SELECT * FROM email_verification_tokens")
    assert len(rows) == 1
    row = rows[0]
    assert row["token_hash"] == hashlib.sha256(raw.encode()).hexdigest()
    assert raw not in json.dumps({k: str(v) for k, v in dict(row).items()})
    assert row["used_at"] is None
    lifetime = (row["expires_at"] - row["created_at"]).total_seconds()
    assert 86_390 <= lifetime <= 86_410


async def test_registration_survives_mailer_failure_without_logging_secrets(
    app: FastAPI, client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
):
    app.state.services.mailer.fail = True
    with caplog.at_level(logging.DEBUG):
        key, token, _ = await _registered(client, email="fail@domain.com")
    assert outbox(app) == []
    assert "verification email delivery failed (MailDeliveryError)" in caplog.text
    assert "fail@domain.com" not in caplog.text
    assert "verifica-email" not in caplog.text
    # The account works and the user can ask for a new email once delivery is back.
    app.state.services.mailer.fail = False
    assert (await authed(client, key, "POST", RESEND, token)).status_code == 204
    assert len(outbox(app)) == 1


async def test_failed_registration_sends_nothing(app: FastAPI, client_factory: ClientFactory):
    await _registered(client_factory("203.0.113.21"), email="dup@domain.com")
    again = await register(client_factory("203.0.113.22"), DPoPKey(), email="dup@domain.com")
    assert again.status_code == 400
    assert len(outbox(app)) == 1


# --- token lifecycle ------------------------------------------------------------------
async def test_verify_valid_token_is_single_use(
    app: FastAPI, client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    await _registered(client)
    raw = token_of(outbox(app)[0])
    ok = await verify(client, raw)  # no DPoP, no Authorization: public endpoint
    assert ok.status_code == 204
    assert await migrator_conn.fetchval("SELECT is_verified FROM users") is True
    assert await migrator_conn.fetchval("SELECT used_at FROM email_verification_tokens")
    again = await verify(client, raw)
    assert again.status_code == 400
    assert again.json() == GENERIC_400


async def test_verify_unknown_tampered_malformed_expired_are_one_generic_400(
    app: FastAPI, client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    await _registered(client)
    raw = token_of(outbox(app)[0])
    tampered = ("A" if raw[0] != "A" else "B") + raw[1:]
    for bad in (tampered, "x" * 43, "not-a-token", "%2e%2e/" + raw[:30], raw + "A"):
        resp = await verify(client, bad)
        assert (resp.status_code, resp.json()) == (400, GENERIC_400), bad
    await migrator_conn.execute(
        "UPDATE email_verification_tokens SET expires_at = now() - interval '1 second'"
    )
    expired = await verify(client, raw)
    assert (expired.status_code, expired.json()) == (400, GENERIC_400)
    assert await migrator_conn.fetchval("SELECT is_verified FROM users") is False
    oversized = await client.post(VERIFY, json={"token": "a" * 129})
    assert oversized.status_code == 422


async def test_verify_email_rate_limited_per_ip(client_factory: ClientFactory):
    c = client_factory("198.51.100.77")
    codes = [(await verify(c, "x" * 43)).status_code for _ in range(11)]
    assert codes == [400] * 10 + [429]
    other = client_factory("198.51.100.78")
    assert (await verify(other, "x" * 43)).status_code == 400


# --- resend ---------------------------------------------------------------------------
async def test_resend_requires_dpop_authentication(client: httpx.AsyncClient):
    assert (await client.post(RESEND)).status_code == 401
    _, token, _ = await _registered(client)
    no_proof = await client.post(RESEND, headers={"Authorization": f"DPoP {token}"})
    assert no_proof.status_code == 401
    other_key = await authed(client, DPoPKey(), "POST", RESEND, token)
    assert other_key.status_code == 401


async def test_resend_invalidates_previous_token(
    app: FastAPI, client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    key, token, _ = await _registered(client)
    first = token_of(outbox(app)[0])
    assert (await authed(client, key, "POST", RESEND, token)).status_code == 204
    assert len(outbox(app)) == 2
    second = token_of(outbox(app)[1])
    assert outbox(app)[1].to == "user@domain.com"  # always the authenticated user's email
    assert second != first
    assert await migrator_conn.fetchval("SELECT count(*) FROM email_verification_tokens") == 1
    assert (await verify(client, first)).status_code == 400
    assert (await verify(client, second)).status_code == 204


async def test_resend_rate_limited_per_user(app: FastAPI, client: httpx.AsyncClient):
    key, token, _ = await _registered(client)
    codes = [(await authed(client, key, "POST", RESEND, token)).status_code for _ in range(4)]
    assert codes == [204, 204, 204, 429]
    assert len(outbox(app)) == 1 + 3


async def test_resend_rate_limited_per_ip(app: FastAPI, client_factory: ClientFactory):
    c = client_factory("198.51.100.90")
    codes = [(await c.post(RESEND)).status_code for _ in range(11)]  # even unauthenticated
    assert codes == [401] * 10 + [429]


async def test_resend_when_already_verified_is_a_noop(app: FastAPI, client: httpx.AsyncClient):
    key, token, _ = await _registered(client)
    assert (await verify(client, token_of(outbox(app)[0]))).status_code == 204
    assert (await authed(client, key, "POST", RESEND, token)).status_code == 204
    assert len(outbox(app)) == 1


async def test_resend_reports_delivery_failure(app: FastAPI, client: httpx.AsyncClient):
    key, token, _ = await _registered(client)
    app.state.services.mailer.fail = True
    resp = await authed(client, key, "POST", RESEND, token)
    assert (resp.status_code, resp.json()) == (503, {"detail": "Email delivery failed"})


# --- /me ------------------------------------------------------------------------------
async def test_me_contract(app: FastAPI, client: httpx.AsyncClient):
    assert (await client.get(ME)).status_code == 401
    key, token, _ = await _registered(client, email="Me@Domain.com")
    resp = await authed(client, key, "GET", ME, token)
    assert resp.status_code == 200
    assert resp.json() == {"email": "me@domain.com", "is_verified": False}
    assert resp.headers["cache-control"] == "no-store"
    await verify(client, token_of(outbox(app)[0]))
    resp = await authed(client, key, "GET", ME, token)
    assert resp.json() == {"email": "me@domain.com", "is_verified": True}
    assert (await authed(client, DPoPKey(), "GET", ME, token)).status_code == 401


# --- no new restrictions on unverified accounts ----------------------------------------
async def test_unverified_local_account_keeps_login_refresh_and_download(
    client: httpx.AsyncClient, migrator_conn: asyncpg.Connection
):
    key, _, cookie = await _registered(client)
    user_id = await migrator_conn.fetchval("SELECT id FROM users")
    await grant(migrator_conn, user_id)
    assert await migrator_conn.fetchval("SELECT is_verified FROM users") is False
    rotated = await refresh(client, key, cookie)
    assert rotated.status_code == 200
    assert (await download(client, key, rotated.json()["access_token"])).status_code == 200
    key2 = DPoPKey()
    again = await login(client, key2)
    assert again.status_code == 200
    assert (await download(client, key2, again.json()["access_token"])).status_code == 200


# --- pre-hijacking (review M2) ---------------------------------------------------------
async def test_prehijack_google_takeover_kills_attacker(
    client_factory: ClientFactory,
    fake_google: FakeGoogle,
    migrator_conn: asyncpg.Connection,
):
    attacker = client_factory("198.51.100.66")
    victim = client_factory("203.0.113.99")
    # 1. The attacker pre-registers the victim's email with a password he knows and keeps
    #    two live sessions (access token + refresh cookie each).
    key_a = DPoPKey()
    reg = await register(attacker, key_a, email=VICTIM, password=ATTACKER_PASSWORD)
    assert reg.status_code == 201
    at_a, cookie_a = reg.json()["access_token"], refresh_cookie_of(reg)
    key_b = DPoPKey()
    second = await login(attacker, key_b, email=VICTIM, password=ATTACKER_PASSWORD)
    assert second.status_code == 200
    at_b, cookie_b = second.json()["access_token"], refresh_cookie_of(second)

    # 2. The victim signs in with Google (email_verified=true) => takes control.
    resp = await _flow(
        victim, fake_google, {"sub": "g-victim", "email": VICTIM, "email_verified": True}
    )
    assert resp.status_code == 200, resp.text
    victim_at = resp.json()["access_token"]

    # 3. Account state: no password, no local identity, verified, Google linked.
    user = await migrator_conn.fetchrow("SELECT * FROM users")
    assert user["password_hash"] is None
    assert user["is_verified"] is True
    idents = await migrator_conn.fetch("SELECT provider, provider_user_id FROM auth_identities")
    assert [tuple(r) for r in idents] == [("google", "g-victim")]
    fams = await migrator_conn.fetch(
        "SELECT dpop_jkt, is_revoked, revoked_reason FROM refresh_token_families"
    )
    by_jkt = {r["dpop_jkt"]: r for r in fams}
    for k in (key_a, key_b):
        assert by_jkt[k.thumbprint]["is_revoked"] is True
        assert by_jkt[k.thumbprint]["revoked_reason"] == "google_takeover"
    assert sum(1 for r in fams if not r["is_revoked"]) == 1  # the victim's new session
    pending = await migrator_conn.fetchval(
        "SELECT count(*) FROM email_verification_tokens WHERE used_at IS NULL"
    )
    assert pending == 0

    # 4. Every attacker credential is dead immediately.
    relogin = await login(attacker, DPoPKey(), email=VICTIM, password=ATTACKER_PASSWORD)
    assert relogin.status_code == 401
    assert (await refresh(attacker, key_a, cookie_a)).status_code == 401
    assert (await refresh(attacker, key_b, cookie_b)).status_code == 401
    assert (await download(attacker, key_a, at_a)).status_code == 401
    assert (await authed(attacker, key_b, "GET", ME, at_b)).status_code == 401
    assert (await authed(attacker, key_a, "POST", RESEND, at_a)).status_code == 401

    # 5. The victim can sign in with Google again (the takeover is not repeated).
    again = await _flow(
        victim, fake_google, {"sub": "g-victim", "email": VICTIM, "email_verified": True}
    )
    assert again.status_code == 200
    assert victim_at


async def test_prehijack_takeover_victim_session_is_usable(
    app: FastAPI,
    client_factory: ClientFactory,
    fake_google: FakeGoogle,
    migrator_conn: asyncpg.Connection,
):
    """Same takeover, driving the Google callback with a known DPoP key so the victim's
    new access token and refresh cookie can be exercised right after the revocation."""
    from tests.test_google import _authorize, _callback, _state_cookie

    attacker = client_factory("198.51.100.67")
    reg = await register(attacker, DPoPKey(), email=VICTIM, password=ATTACKER_PASSWORD)
    assert reg.status_code == 201
    attacker_token = token_of(outbox(app)[0])  # (in reality: sits in the victim's inbox)

    victim = client_factory("203.0.113.98")
    key_v = DPoPKey()
    auth, params = await _authorize(victim)
    fake_google.register_code(
        "code-v",
        code_challenge=params["code_challenge"],
        claims={
            "nonce": params["nonce"],
            "sub": "g-v",
            "email": VICTIM,
            "email_verified": True,
        },
    )
    resp = await _callback(
        victim, key_v, code="code-v", state=params["state"], state_cookie=_state_cookie(auth)
    )
    assert resp.status_code == 200, resp.text
    at = resp.json()["access_token"]
    me = await authed(victim, key_v, "GET", ME, at)
    assert (me.status_code, me.json()) == (200, {"email": VICTIM, "is_verified": True})
    rotated = await refresh(victim, key_v, refresh_cookie_of(resp))
    assert rotated.status_code == 200
    # The verification token mailed at the attacker's registration is gone.
    assert (await verify(victim, attacker_token)).status_code == 400


async def test_verified_local_account_is_linked_not_taken_over(
    app: FastAPI,
    client_factory: ClientFactory,
    fake_google: FakeGoogle,
    migrator_conn: asyncpg.Connection,
):
    owner = client_factory("203.0.113.50")
    key, token, cookie = await _registered(owner, email="owner@domain.com")
    assert (await verify(owner, token_of(outbox(app)[0]))).status_code == 204
    resp = await _flow(
        owner, fake_google, {"sub": "g-owner", "email": "owner@domain.com", "email_verified": True}
    )
    assert resp.status_code == 200
    assert await migrator_conn.fetchval("SELECT password_hash IS NOT NULL FROM users") is True
    providers = await migrator_conn.fetch("SELECT provider FROM auth_identities ORDER BY provider")
    assert [r["provider"] for r in providers] == ["google", "local"]
    # Existing local sessions are untouched, password login still works.
    assert (
        await migrator_conn.fetchval("SELECT count(*) FROM refresh_token_families WHERE is_revoked")
        == 0
    )
    assert (await authed(owner, key, "GET", ME, token)).status_code == 200
    assert (await refresh(owner, key, cookie)).status_code == 200
    assert (await login(owner, DPoPKey(), email="owner@domain.com")).status_code == 200


async def test_google_takeover_requires_email_verified_true(
    client: httpx.AsyncClient, fake_google: FakeGoogle, migrator_conn: asyncpg.Connection
):
    await _registered(client, email="victim2@domain.com")
    resp = await _flow(
        client, fake_google, {"sub": "g-x", "email": "victim2@domain.com", "email_verified": False}
    )
    assert resp.status_code == 400
    assert await migrator_conn.fetchval("SELECT password_hash IS NOT NULL FROM users") is True
    assert await login(client, DPoPKey(), email="victim2@domain.com", password=STRONG_PASSWORD)


# --- database -------------------------------------------------------------------------
async def test_verification_table_privileges_and_schema(migrator_conn: asyncpg.Connection):
    privs = await migrator_conn.fetch(
        "SELECT privilege_type FROM information_schema.role_table_grants "
        "WHERE grantee = 'nzt_app' AND table_name = 'email_verification_tokens'"
    )
    assert {r["privilege_type"] for r in privs} == {"SELECT", "INSERT", "UPDATE", "DELETE"}
    cols = {
        r["column_name"]: r
        for r in await migrator_conn.fetch(
            "SELECT column_name, is_nullable, data_type, character_maximum_length "
            "FROM information_schema.columns WHERE table_name = 'email_verification_tokens'"
        )
    }
    assert set(cols) == {"id", "user_id", "token_hash", "expires_at", "used_at", "created_at"}
    assert cols["token_hash"]["character_maximum_length"] == 64
    assert cols["used_at"]["is_nullable"] == "YES"
    fk = await migrator_conn.fetchval(
        "SELECT confdeltype::text FROM pg_constraint "
        "WHERE conrelid = 'email_verification_tokens'::regclass AND contype = 'f'"
    )
    assert fk == "c"  # ON DELETE CASCADE


# --- mailer configuration and Resend request shape --------------------------------------
_PROD: dict[str, Any] = {
    "environment": "production",
    "access_token_private_key_pem": "x",
    "oauth_state_key": base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("="),
    "launcher_sha256": "ab" * 32,
    "database_sslmode": "verify-full",
    "trusted_proxy_cidrs": ["10.0.0.0/8"],
    "mail_backend": "resend",
    "resend_api_key": "re_test_key",
    "mail_from": "NZT Solutions <noreply@nztsolutions.it>",
}


def test_production_mailer_guards():
    assert make_settings(**_PROD).mail_backend == "resend"
    for backend in ("console", "file", "memory"):
        with pytest.raises(ValidationError, match="NZT_MAIL_BACKEND=resend"):
            make_settings(**{**_PROD, "mail_backend": backend, "mail_file_dir": "out"})
    with pytest.raises(ValidationError, match="NZT_RESEND_API_KEY"):
        make_settings(**{**_PROD, "resend_api_key": None})
    with pytest.raises(ValidationError, match="NZT_MAIL_FROM"):
        make_settings(**{**_PROD, "mail_from": None})
    with pytest.raises(ValidationError, match="NZT_MAIL_FILE_DIR"):
        make_settings(mail_backend="file")
    with pytest.raises(ValidationError, match="mail_from"):
        make_settings(mail_from="a@b.c\r\nBcc: x@y.z")
    s = make_settings(**_PROD)
    assert "re_test_key" not in repr(s)
    assert s.email_verification_ttl_seconds == 86_400
    with pytest.raises(ValidationError):
        make_settings(email_verification_ttl_seconds=60)


def test_dev_mailers_are_selected_outside_production(tmp_path: Any):
    from app.services.mailer import ConsoleMailer, FileMailer, MemoryMailer, build_mailer

    assert isinstance(build_mailer(make_settings(mail_backend="console")), ConsoleMailer)
    assert isinstance(build_mailer(make_settings(mail_backend="memory")), MemoryMailer)
    fm = build_mailer(make_settings(mail_backend="file", mail_file_dir=str(tmp_path)))
    assert isinstance(fm, FileMailer)


async def test_file_mailer_writes_private_files(tmp_path: Any):
    from app.services.mailer import FileMailer, OutgoingEmail

    await FileMailer(str(tmp_path / "out")).send(OutgoingEmail("a@b.it", "s", "t"))
    files = list((tmp_path / "out").iterdir())
    assert len(files) == 1
    assert files[0].stat().st_mode & 0o777 == 0o600
    assert json.loads(files[0].read_text()) == {"to": "a@b.it", "subject": "s", "text": "t"}


async def test_resend_mailer_request_shape_and_no_retries():
    from app.services.mailer import (
        RESEND_ENDPOINT,
        MailDeliveryError,
        OutgoingEmail,
        build_mailer,
    )

    seen: list[httpx.Request] = []
    status = {"code": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if status["code"] == 0:
            raise httpx.ConnectTimeout("boom", request=request)
        return httpx.Response(status["code"], json={"id": "msg_1"})

    mailer = build_mailer(make_settings(**_PROD), transport=httpx.MockTransport(handler))
    msg = OutgoingEmail(to="user@domain.com", subject="Oggetto", text="Corpo")
    await mailer.send(msg)
    req = seen[0]
    assert req.method == "POST"
    assert str(req.url) == RESEND_ENDPOINT == "https://api.resend.com/emails"
    assert req.headers["authorization"] == "Bearer re_test_key"
    assert req.headers["content-type"] == "application/json"
    assert json.loads(req.content) == {
        "from": "NZT Solutions <noreply@nztsolutions.it>",
        "to": ["user@domain.com"],
        "subject": "Oggetto",
        "text": "Corpo",
    }
    for code in (500, 302, 0):  # provider error, redirect (not followed), network error
        status["code"] = code
        before = len(seen)
        with pytest.raises(MailDeliveryError) as exc:
            await mailer.send(msg)
        assert len(seen) == before + 1  # exactly one attempt, no retry storm
        assert "user@domain.com" not in str(exc.value)
        assert "Corpo" not in str(exc.value)
    await mailer.aclose()

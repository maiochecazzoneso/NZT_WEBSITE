"""Redis sliding-window rate limits, exact spec §9.2 values (D-A10) + client IP logic."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from redis.asyncio import Redis

from app.client_ip import ClientIPResolver
from app.db import Collections
from app.main import create_app
from app.ratelimit import (
    DOWNLOADS_PER_USER,
    LOGIN_PER_EMAIL,
    LOGIN_PER_IP,
    REFRESH_PER_FAMILY,
    REGISTER_PER_IP,
    RateLimit,
    RateLimiter,
    RateLimitExceededError,
)
from tests.conftest import (
    REDIS_URL,
    ClientFactory,
    download,
    grant,
    login,
    make_settings,
    one,
    only_user_id,
    refresh,
    refresh_cookie_of,
    register,
)
from tests.helpers import API_BASE, DPoPKey


def test_spec_values_are_exact():
    assert (LOGIN_PER_IP.limit, LOGIN_PER_IP.window_seconds) == (5, 60)
    assert (LOGIN_PER_EMAIL.limit, LOGIN_PER_EMAIL.window_seconds) == (5, 60)
    assert (REGISTER_PER_IP.limit, REGISTER_PER_IP.window_seconds) == (3, 3600)
    assert (REFRESH_PER_FAMILY.limit, REFRESH_PER_FAMILY.window_seconds) == (30, 60)
    assert (DOWNLOADS_PER_USER.limit, DOWNLOADS_PER_USER.window_seconds) == (10, 3600)


def _assert_429(resp: httpx.Response, max_retry: int) -> None:
    assert resp.status_code == 429, resp.text
    assert resp.json() == {"detail": "Too many requests"}
    retry = int(resp.headers["retry-after"])
    assert 1 <= retry <= max_retry


async def test_login_per_ip(client_factory: ClientFactory):
    c = client_factory("198.51.100.20")
    for i in range(5):
        r = await login(c, DPoPKey(), email=f"u{i}@domain.com")
        assert r.status_code == 401
    _assert_429(await login(c, DPoPKey(), email="u9@domain.com"), 120)
    # Another IP is unaffected.
    assert (await login(client_factory("198.51.100.21"), DPoPKey())).status_code == 401


async def test_login_per_email(client_factory: ClientFactory):
    for i in range(5):
        r = await login(
            client_factory(f"198.51.100.{30 + i}"), DPoPKey(), email="Target@Domain.com"
        )
        assert r.status_code == 401
    # Normalised email (case/whitespace) shares the bucket, from a fresh IP.
    _assert_429(
        await login(client_factory("198.51.100.40"), DPoPKey(), email=" target@domain.com "), 120
    )
    assert (
        await login(client_factory("198.51.100.41"), DPoPKey(), email="other@domain.com")
    ).status_code == 401


async def test_register_per_ip(client_factory: ClientFactory):
    c = client_factory("198.51.100.50")
    for i in range(3):
        assert (await register(c, DPoPKey(), email=f"r{i}@domain.com")).status_code == 201
    # Counted before body validation/DPoP: even an invalid request is limited.
    resp = await c.post("/api/v1/auth/register", json={})
    _assert_429(resp, 7200)
    assert (
        await register(client_factory("198.51.100.51"), DPoPKey(), email="r9@domain.com")
    ).status_code == 201


async def test_refresh_per_family(client_factory: ClientFactory):
    c = client_factory("198.51.100.60")
    key = DPoPKey()
    cookie = refresh_cookie_of(await register(c, key))
    for _ in range(30):
        r = await refresh(c, key, cookie=cookie)
        assert r.status_code == 200, r.text
        cookie = refresh_cookie_of(r)
    _assert_429(await refresh(c, key, cookie=cookie), 120)
    # A different family (new login) has its own budget.
    other_key = DPoPKey()
    other = refresh_cookie_of(await login(client_factory("198.51.100.61"), other_key))
    assert (await refresh(c, other_key, cookie=other)).status_code == 200


async def test_downloads_per_user(client: httpx.AsyncClient, mongo: Collections):
    key = DPoPKey()
    token = (await register(client, key)).json()["access_token"]
    await grant(mongo, await only_user_id(mongo))
    for _ in range(10):
        assert (await download(client, key, token)).status_code == 200
    _assert_429(await download(client, key, token), 7200)
    assert await mongo.download_logs.count_documents({}) == 10


async def test_sliding_window_recovers():
    redis = Redis.from_url(REDIS_URL)
    limiter = RateLimiter(redis)
    rule = RateLimit("unit", 2, 1)
    await limiter.hit(rule, "k")
    await limiter.hit(rule, "k")
    with pytest.raises(RateLimitExceededError) as exc:
        await limiter.hit(rule, "k")
    assert exc.value.retry_after >= 1
    await asyncio.sleep(2.1)
    await limiter.hit(rule, "k")
    await redis.aclose()


async def test_redis_outage_fails_closed():
    settings = make_settings(redis_url="redis://127.0.0.1:1/0")
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("198.51.100.70", 1))
        async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c:
            resp = await login(c, DPoPKey())
    assert resp.status_code == 503
    assert resp.json() == {"detail": "Service temporarily unavailable"}


# --- client IP ------------------------------------------------------------------------
def test_client_ip_default_ignores_forwarded_headers():
    r = ClientIPResolver([])
    assert r.resolve("192.0.2.1", "1.2.3.4") == "192.0.2.1"


def test_client_ip_trusted_proxy_chain():
    r = ClientIPResolver(["10.0.0.0/8"])
    assert r.resolve("10.0.0.5", "198.51.100.1, 10.0.0.7") == "198.51.100.1"
    # Client-supplied spoofed entries left of the real client are ignored.
    assert r.resolve("10.0.0.5", "6.6.6.6, 198.51.100.1") == "198.51.100.1"
    # Untrusted peer: header ignored.
    assert r.resolve("192.0.2.9", "198.51.100.1") == "192.0.2.9"
    # Garbage hop: stop at last trusted address.
    assert r.resolve("10.0.0.5", "198.51.100.1, garbage") == "10.0.0.5"
    assert r.resolve("10.0.0.5", None) == "10.0.0.5"
    assert r.resolve(None, "1.1.1.1") == "0.0.0.0"  # noqa: S104


async def test_spoofed_xff_cannot_evade_login_limit(client_factory: ClientFactory):
    c = client_factory("198.51.100.80")
    for i in range(5):
        r = await c.post(
            "/api/v1/auth/login",
            json={"email": f"s{i}@domain.com", "password": "x"},
            headers={
                "DPoP": DPoPKey().proof("POST", "/api/v1/auth/login"),
                "X-Forwarded-For": f"192.0.2.{i}",
            },
        )
        assert r.status_code == 401
    r = await c.post(
        "/api/v1/auth/login",
        json={"email": "s9@domain.com", "password": "x"},
        headers={
            "DPoP": DPoPKey().proof("POST", "/api/v1/auth/login"),
            "X-Forwarded-For": "192.0.2.99",
        },
    )
    assert r.status_code == 429


async def test_trusted_proxy_xff_used_for_limits_and_audit(fake_google: object, mongo: Collections):
    settings = make_settings(trusted_proxy_cidrs=["10.0.0.0/8"])
    app: FastAPI = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("10.1.2.3", 1))
        async with httpx.AsyncClient(transport=transport, base_url=API_BASE) as c:
            key = DPoPKey()
            reg = await c.post(
                "/api/v1/auth/register",
                json={"email": "p@domain.com", "password": "SuperSecurePassword123!"},
                headers={
                    "DPoP": key.proof("POST", "/api/v1/auth/register"),
                    "X-Forwarded-For": "198.51.100.200",
                },
            )
            token = reg.json()["access_token"]
            await grant(mongo, await only_user_id(mongo))
            path = "/api/v1/downloads/launcher"
            resp = await c.get(
                path,
                headers={
                    "Authorization": f"DPoP {token}",
                    "DPoP": key.proof("GET", path, access_token=token),
                    "X-Forwarded-For": "198.51.100.201, 10.9.9.9",
                },
            )
            assert resp.status_code == 200
    assert (await one(mongo.download_logs))["ipAddress"] == "198.51.100.201"

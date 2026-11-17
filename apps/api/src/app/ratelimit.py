"""Redis sliding-window-counter rate limiting (spec §9.2, D-A10).

Two fixed buckets (current + previous window); the previous bucket is weighted by the
fraction of the window still overlapping. The check+increment is one atomic Lua script
using the Redis server clock. Fail-CLOSED: if Redis is unavailable the request is
rejected with 503 (auth/download endpoints must never become unlimited)."""

from __future__ import annotations

import hashlib
import logging
import math
from dataclasses import dataclass
from typing import Final

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

# Lua: KEYS[1] = key prefix, ARGV[1] = window ms, ARGV[2] = limit.
# Returns {allowed(0/1), retry_after_ms}.
_SLIDING_WINDOW_LUA: Final = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local cur_idx = math.floor(now / window)
local elapsed = now - cur_idx * window
local cur_key = KEYS[1] .. ':' .. cur_idx
local prev_key = KEYS[1] .. ':' .. (cur_idx - 1)
local cur = tonumber(redis.call('GET', cur_key) or '0')
local prev = tonumber(redis.call('GET', prev_key) or '0')
local weighted = prev * ((window - elapsed) / window) + cur
if weighted + 1 > limit then
  local retry
  if cur >= limit then
    retry = (window - elapsed) + window * (1 - (limit - 1) / cur)
  else
    retry = window * (1 - (limit - 1 - cur) / prev) - elapsed
  end
  if retry < 1 then retry = 1 end
  return {0, math.ceil(retry)}
end
redis.call('INCR', cur_key)
redis.call('PEXPIRE', cur_key, window * 2)
return {1, 0}
"""


@dataclass(frozen=True, slots=True)
class RateLimit:
    name: str
    limit: int
    window_seconds: int


# Spec §9.2 - exact values, intentionally NOT configurable via env.
LOGIN_PER_IP: Final = RateLimit("login:ip", 5, 60)
LOGIN_PER_EMAIL: Final = RateLimit("login:email", 5, 60)
REGISTER_PER_IP: Final = RateLimit("register:ip", 3, 3600)
REFRESH_PER_FAMILY: Final = RateLimit("refresh:family", 30, 60)
DOWNLOADS_PER_USER: Final = RateLimit("downloads:user", 10, 3600)
# Addition to spec §9.2 (review L6): Google OIDC endpoints, per client IP, same sliding
# window and fail-closed behaviour. authorize is cheap (no egress) but sets a cookie;
# callback costs one server-side POST to Google's token endpoint per call.
GOOGLE_AUTHORIZE_PER_IP: Final = RateLimit("google:authorize:ip", 20, 60)
GOOGLE_CALLBACK_PER_IP: Final = RateLimit("google:callback:ip", 10, 60)
# Addition (email verification): public token check per client IP; resend per user AND per
# client IP (each resend sends one email).
VERIFY_EMAIL_PER_IP: Final = RateLimit("verify_email:ip", 10, 60)
RESEND_VERIFICATION_PER_USER: Final = RateLimit("resend_verification:user", 3, 3600)
RESEND_VERIFICATION_PER_IP: Final = RateLimit("resend_verification:ip", 10, 3600)


class RateLimitExceededError(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate limit exceeded")
        self.retry_after = retry_after


class RateLimitUnavailableError(Exception):
    pass


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self._script = redis.register_script(_SLIDING_WINDOW_LUA)

    async def hit(self, rule: RateLimit, identifier: str) -> None:
        # Identifiers (emails, IPs) are hashed so no PII is stored in Redis keys.
        digest = hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:32]
        key = f"rl:{rule.name}:{digest}"
        try:
            allowed, retry_ms = await self._script(
                keys=[key], args=[rule.window_seconds * 1000, rule.limit]
            )
        except RedisError as exc:
            logger.error("rate limiter unavailable (fail-closed): %s", type(exc).__name__)
            raise RateLimitUnavailableError from exc
        if int(allowed) != 1:
            raise RateLimitExceededError(max(1, math.ceil(int(retry_ms) / 1000)))

"""Session manager: refresh-token families, Refresh Token Rotation with reuse detection
(spec §6.2-6.3, D-A7, D-A8) on MongoDB.

Data model:
* ``refreshTokenFamilies`` - one document per session (DPoP key binding, revocation state)
  holding the CURRENT token hash and its expiry;
* ``refreshTokens`` - ``_id = sha256(token)`` for EVERY token ever issued -> its family
  (reuse detection, per-family rate limit, logout). Expired documents are removed by TTL.

Atomic rotation (D-A8) = ONE single-document compare-and-swap, no transaction:
    findOneAndUpdate(
        {_id: family, currentTokenHash: h, isRevoked: false, dpopJkt: jkt, expiresAt > now},
        {$set: {currentTokenHash: new, expiresAt: ...}})
Document-level atomicity guarantees that of N concurrent requests presenting the same
token exactly one matches. A loser finds ``currentTokenHash != h``: the token was already
used => REUSE (every family of the user is revoked and already issued access tokens are
killed through the Redis marker). The new token's ``refreshTokens`` document is written
BEFORE the swap, so every token that can ever be handed out is known to the reuse
detector (a failed swap deletes it again). The frontend serialises refreshes with Web
Locks (spec §6.4).

Access-token revocation markers (review L3). Revoking families does not touch access
tokens already issued, so revocation also writes a Redis marker "every access token of
this user / DPoP key issued at or before instant M is dead". The ordering uses ONE clock
with millisecond resolution, the Redis server clock (TIME), for both sides:
* the marker M is read from TIME inside a Lua script AFTER the revoking update has been
  acknowledged by the majority, and the stored value only ever moves forward;
* every access token carries ``iat_ms`` = Redis TIME captured BEFORE the database work
  that issues it (family creation / swap).
A token is rejected iff ``iat_ms <= M``. A swap that won before the revoking update had
its ``iat_ms`` taken before it, hence before M: its access token is dead and its new
refresh token belongs to a revoked family. A swap after the update cannot match
(``isRevoked: false``). A token minted after the revocation (the legitimate re-login in
the same second) is accepted; the same millisecond fails CLOSED. Using the Redis clock
removes skew between API replicas. Legacy second-resolution markers (rolling deploys of
older replicas) are still honoured; they expire after access_ttl + 5 s."""

from __future__ import annotations

import asyncio
import enum
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta

from redis.asyncio import Redis

from app.db import NOT_TAKEOVER_PENDING, Collections, utcnow
from app.security.tokens import AccessTokenService, hash_refresh_token, new_refresh_token

_REFRESH_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

USER_REVOKED_AFTER_MS = "user_revoked_after_ms:{}"
JKT_REVOKED_AFTER_MS = "jkt_revoked_after_ms:{}"
# Legacy (second-resolution) markers: read-only, for rolling deploys (see docstring).
LEGACY_USER_REVOKED_AFTER = "user_revoked_after:{}"
LEGACY_JKT_REVOKED_AFTER = "jkt_revoked_after:{}"

# KEYS[1] = marker key, ARGV[1] = TTL seconds. Marker := max(current, Redis TIME in ms).
_MARK_REVOKED_LUA = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local cur = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
if now > cur then cur = now end
redis.call('SET', KEYS[1], string.format('%d', cur), 'EX', tonumber(ARGV[1]))
return cur
"""


class RefreshOutcome(enum.Enum):
    INVALID = "invalid"  # unknown/malformed token
    EXPIRED = "expired"
    REVOKED = "revoked"  # family revoked (logout / previous reuse) or user not allowed
    KEY_MISMATCH = "key_mismatch"  # DPoP key differs from the family key
    REUSE = "reuse"  # already-used token presented again => compromise


class RefreshError(Exception):
    def __init__(self, outcome: RefreshOutcome) -> None:
        super().__init__(outcome.value)
        self.outcome = outcome


@dataclass(frozen=True, slots=True)
class IssuedSession:
    access_token: str
    refresh_token: str
    expires_in: int
    family_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class TokenRef:
    """A presented refresh token that the server issued: its hash and family."""

    token_hash: str
    family_id: uuid.UUID


def is_well_formed_refresh_token(raw: str | None) -> bool:
    return raw is not None and _REFRESH_TOKEN_RE.fullmatch(raw) is not None


class SessionService:
    def __init__(
        self,
        *,
        tokens: AccessTokenService,
        redis: Redis,
        db: Collections,
        refresh_ttl_seconds: int,
    ) -> None:
        self._tokens = tokens
        self._redis = redis
        self._db = db
        self._refresh_ttl = timedelta(seconds=refresh_ttl_seconds)
        self._mark_script = redis.register_script(_MARK_REVOKED_LUA)

    @property
    def access_ttl(self) -> int:
        return self._tokens.ttl

    async def clock_ms(self) -> int:
        """Shared Redis clock in ms (the ordering clock of the revocation markers)."""
        seconds, micros = await self._redis.time()
        return int(seconds) * 1000 + int(micros) // 1000

    async def _mark_revoked(self, key: str) -> int:
        return int(await self._mark_script(keys=[key], args=[self.access_ttl + 5]))

    def _issued(
        self, *, user_id: uuid.UUID, jkt: str, issued_ms: int, raw: str, family_id: uuid.UUID
    ) -> IssuedSession:
        return IssuedSession(
            access_token=self._tokens.issue(user_id=user_id, jkt=jkt, issued_ms=issued_ms),
            refresh_token=raw,
            expires_in=self._tokens.ttl,
            family_id=family_id,
        )

    async def lookup(self, raw: str | None) -> TokenRef | None:
        """The family of any token the server issued (current or already used)."""
        if not is_well_formed_refresh_token(raw):
            return None
        assert raw is not None
        token_hash = hash_refresh_token(raw)
        doc = await self._db.refresh_tokens.find_one({"_id": token_hash}, {"familyId": 1})
        return TokenRef(token_hash, doc["familyId"]) if doc is not None else None

    async def create_session(self, *, user_id: uuid.UUID, jkt: str) -> IssuedSession:
        """New family bound to the DPoP key + its first refresh token."""
        issued_ms = await self.clock_ms()  # BEFORE the database work (see docstring)
        now = utcnow()
        family_id = uuid.uuid4()
        raw = new_refresh_token()
        token_hash = hash_refresh_token(raw)
        expires_at = now + self._refresh_ttl
        await self._db.refresh_tokens.insert_one(
            {"_id": token_hash, "familyId": family_id, "expiresAt": expires_at, "createdAt": now}
        )
        await self._db.families.insert_one(
            {
                "_id": family_id,
                "userId": user_id,
                "dpopJkt": jkt,
                "isRevoked": False,
                "revokedReason": None,
                "currentTokenHash": token_hash,
                "expiresAt": expires_at,
                "createdAt": now,
                "updatedAt": now,
            }
        )
        return self._issued(
            user_id=user_id, jkt=jkt, issued_ms=issued_ms, raw=raw, family_id=family_id
        )

    async def rotate(
        self, ref: TokenRef | None, *, jkt: str, required_role: str | None = None
    ) -> IssuedSession:
        """RTR. ``required_role`` (admin dashboard): the session is revoked and REVOKED
        raised when the user no longer has that role."""
        if ref is None:
            raise RefreshError(RefreshOutcome.INVALID)
        issued_ms = await self.clock_ms()  # BEFORE the swap (see docstring)
        now = utcnow()
        new_raw = new_refresh_token()
        new_hash = hash_refresh_token(new_raw)
        new_expiry = now + self._refresh_ttl
        await self._db.refresh_tokens.insert_one(
            {"_id": new_hash, "familyId": ref.family_id, "expiresAt": new_expiry, "createdAt": now}
        )
        family = await self._db.families.find_one_and_update(
            {
                "_id": ref.family_id,
                "currentTokenHash": ref.token_hash,
                "isRevoked": False,
                "dpopJkt": jkt,
                "expiresAt": {"$gt": now},
            },
            {"$set": {"currentTokenHash": new_hash, "expiresAt": new_expiry, "updatedAt": now}},
            projection={"userId": 1},
        )
        if family is not None:
            user_id: uuid.UUID = family["userId"]
            allowed: dict[str, object] = {
                "_id": user_id,
                "isActive": True,
                **NOT_TAKEOVER_PENDING,
            }
            if required_role is not None:
                allowed["role"] = required_role
            if await self._db.users.find_one(allowed, {"_id": 1}) is None:
                await self.revoke_family(ref.family_id, reason="user_not_allowed")
                raise RefreshError(RefreshOutcome.REVOKED)
            return self._issued(
                user_id=user_id, jkt=jkt, issued_ms=issued_ms, raw=new_raw, family_id=ref.family_id
            )

        # Nothing swapped: the new token is never handed out. Classify why.
        await self._db.refresh_tokens.delete_one({"_id": new_hash})
        state = await self._db.families.find_one(
            {"_id": ref.family_id},
            {"currentTokenHash": 1, "isRevoked": 1, "expiresAt": 1, "dpopJkt": 1, "userId": 1},
        )
        if state is None:
            raise RefreshError(RefreshOutcome.INVALID)
        if state["currentTokenHash"] != ref.token_hash:
            await self.revoke_all_for_user(state["userId"], reason="reuse_detected")
            raise RefreshError(RefreshOutcome.REUSE)
        if state["isRevoked"]:
            raise RefreshError(RefreshOutcome.REVOKED)
        if state["expiresAt"] <= now:
            raise RefreshError(RefreshOutcome.EXPIRED)
        if state["dpopJkt"] != jkt:
            raise RefreshError(RefreshOutcome.KEY_MISMATCH)
        raise RefreshError(RefreshOutcome.INVALID)  # pragma: no cover - lost race edge

    async def revoke_family(self, family_id: uuid.UUID, *, reason: str) -> None:
        await self._db.families.update_one(
            {"_id": family_id, "isRevoked": False},
            {"$set": {"isRevoked": True, "revokedReason": reason, "updatedAt": utcnow()}},
        )

    async def revoke_all_for_user(self, user_id: uuid.UUID, *, reason: str) -> int:
        """Revoke EVERY family of the user and kill already-issued access tokens (D-A7).
        Returns the marker instant (Redis clock, ms)."""
        await self._db.families.update_many(
            {"userId": user_id, "isRevoked": False},
            {"$set": {"isRevoked": True, "revokedReason": reason, "updatedAt": utcnow()}},
        )
        return await self._mark_revoked(USER_REVOKED_AFTER_MS.format(user_id))

    async def wait_until_after(self, marker_ms: int) -> None:
        """Wait until the shared Redis clock has passed ``marker_ms``, so a session created
        next for the legitimate owner (Google takeover) is not caught by the
        same-millisecond fail-closed rule."""
        for _ in range(1000):  # normally 0-2 iterations (1 ms resolution)
            if await self.clock_ms() > marker_ms:
                return
            await asyncio.sleep(0.001)
        raise RuntimeError("Redis clock did not advance")  # pragma: no cover

    async def logout(self, ref: TokenRef | None, *, jkt: str) -> bool:
        """Revoke the family of the presented token. False when the DPoP key does not
        match. Unknown tokens are treated as already logged out (idempotent)."""
        if ref is None:
            return True
        family = await self._db.families.find_one({"_id": ref.family_id}, {"dpopJkt": 1})
        if family is None:
            return True
        if family["dpopJkt"] != jkt:
            return False
        await self.revoke_family(ref.family_id, reason="logout")
        # Kill access tokens bound to this key that were issued up to now.
        await self._mark_revoked(JKT_REVOKED_AFTER_MS.format(jkt))
        return True

    async def is_access_token_revoked(
        self, *, user_id: uuid.UUID, jkt: str, iat: int, iat_ms: int
    ) -> bool:
        user_ms, jkt_ms, legacy_user, legacy_jkt = await self._redis.mget(
            USER_REVOKED_AFTER_MS.format(user_id),
            JKT_REVOKED_AFTER_MS.format(jkt),
            LEGACY_USER_REVOKED_AFTER.format(user_id),
            LEGACY_JKT_REVOKED_AFTER.format(jkt),
        )
        for marker in (user_ms, jkt_ms):
            if marker is not None and iat_ms <= int(marker):
                return True
        for marker in (legacy_user, legacy_jkt):
            if marker is not None and iat <= int(marker):
                return True
        return False

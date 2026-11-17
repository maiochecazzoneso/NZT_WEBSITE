"""Session manager: refresh-token families, Refresh Token Rotation with reuse detection
(spec §6.2-6.3, D-A7, D-A8).

Atomic rotation design (D-A8): one conditional
    UPDATE refresh_tokens SET is_used = TRUE
    FROM refresh_token_families f
    WHERE token_hash = :h AND is_used = FALSE AND expires_at > now()
      AND f.id = family_id AND f.is_revoked = FALSE AND f.dpop_jkt = :jkt
    RETURNING ...
Postgres row locking guarantees that of N concurrent requests presenting the same token
exactly one UPDATE matches; the others re-check the row after the winner commits, see
is_used = TRUE and are classified as REUSE (=> every family of the user is revoked and
already issued access tokens are killed through the Redis marker). The frontend must
serialise refreshes with Web Locks (spec §6.4).

Access-token revocation markers (review L3). Revoking families does not touch access
tokens already issued, so revocation also writes a Redis marker "every access token of
this user / DPoP key issued at or before instant M is dead". The ordering uses ONE clock
with millisecond resolution, the Redis server clock (TIME), for both sides:
* the marker M is read from TIME inside a Lua script AFTER the revoking UPDATE (logout:
  after its commit; reuse: while the UPDATE's row locks are held, committed right after),
  and the stored value only ever moves forward (max(old, new));
* every access token carries ``iat_ms`` = Redis TIME captured BEFORE the DB work that
  issues it (refresh-token consume / family creation).
A token is rejected iff ``iat_ms <= M``. Therefore any token whose consume ran before the
revoking UPDATE is rejected (its instant precedes M), a consume that runs after it cannot
succeed (the family is revoked; a concurrent one waits on the row lock and then fails),
a token minted after the revocation (e.g. the legitimate re-login in the same wall-clock
second, previously rejected because both sides were truncated to whole seconds) is
accepted, and the only ambiguous case, the same millisecond, fails CLOSED. Using the
Redis clock removes skew between API replicas. Legacy second-resolution markers
(written by a not-yet-upgraded replica during a rolling deploy) are still honoured with
the old semantics; they expire after access_ttl + 5 s."""

from __future__ import annotations

import asyncio
import enum
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken, RefreshTokenFamily, User
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
    REVOKED = "revoked"  # family revoked (logout / previous reuse)
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


def is_well_formed_refresh_token(raw: str | None) -> bool:
    return raw is not None and _REFRESH_TOKEN_RE.fullmatch(raw) is not None


class SessionService:
    def __init__(
        self, *, tokens: AccessTokenService, redis: Redis, refresh_ttl_seconds: int
    ) -> None:
        self._tokens = tokens
        self._redis = redis
        self._refresh_ttl = refresh_ttl_seconds
        self._mark_script = redis.register_script(_MARK_REVOKED_LUA)

    @property
    def access_ttl(self) -> int:
        return self._tokens.ttl

    def _expiry(self) -> datetime:
        return datetime.now(UTC) + timedelta(seconds=self._refresh_ttl)

    async def clock_ms(self) -> int:
        """Shared Redis clock in ms (the ordering clock of the revocation markers)."""
        seconds, micros = await self._redis.time()
        return int(seconds) * 1000 + int(micros) // 1000

    async def _mark_revoked(self, key: str) -> None:
        await self._mark_script(keys=[key], args=[self.access_ttl + 5])

    async def create_session(
        self, db: AsyncSession, *, user_id: uuid.UUID, jkt: str
    ) -> IssuedSession:
        """New family bound to the DPoP key + first refresh token. Caller commits."""
        issued_ms = await self.clock_ms()  # BEFORE the DB work (see module docstring)
        family = RefreshTokenFamily(id=uuid.uuid4(), user_id=user_id, dpop_jkt=jkt)
        db.add(family)
        await db.flush()
        raw = new_refresh_token()
        db.add(
            RefreshToken(
                id=uuid.uuid4(),
                family_id=family.id,
                token_hash=hash_refresh_token(raw),
                expires_at=self._expiry(),
            )
        )
        await db.flush()
        return IssuedSession(
            access_token=self._tokens.issue(user_id=user_id, jkt=jkt, issued_ms=issued_ms),
            refresh_token=raw,
            expires_in=self._tokens.ttl,
            family_id=family.id,
        )

    async def family_id_for(self, db: AsyncSession, raw: str | None) -> uuid.UUID | None:
        if not is_well_formed_refresh_token(raw):
            return None
        assert raw is not None
        result = await db.execute(
            select(RefreshToken.family_id).where(RefreshToken.token_hash == hash_refresh_token(raw))
        )
        return result.scalar_one_or_none()

    async def rotate(self, db: AsyncSession, *, raw: str | None, jkt: str) -> IssuedSession:
        """RTR. Commits on success AND on reuse detection (revocation must persist)."""
        if not is_well_formed_refresh_token(raw):
            raise RefreshError(RefreshOutcome.INVALID)
        assert raw is not None
        token_hash = hash_refresh_token(raw)
        issued_ms = await self.clock_ms()  # BEFORE the consume (see module docstring)

        consumed = await db.execute(
            update(RefreshToken)
            .where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.is_used.is_(False),
                    RefreshToken.expires_at > func.now(),
                    RefreshTokenFamily.id == RefreshToken.family_id,
                    RefreshTokenFamily.is_revoked.is_(False),
                    RefreshTokenFamily.dpop_jkt == jkt,
                )
            )
            .values(is_used=True)
            .returning(RefreshToken.family_id, RefreshTokenFamily.user_id)
            .execution_options(synchronize_session=False)
        )
        row = consumed.one_or_none()
        if row is not None:
            family_id, user_id = row
            user_ok = await db.execute(
                select(User.id).where(User.id == user_id, User.is_active.is_(True))
            )
            if user_ok.scalar_one_or_none() is None:
                await db.rollback()
                raise RefreshError(RefreshOutcome.REVOKED)
            new_raw = new_refresh_token()
            db.add(
                RefreshToken(
                    id=uuid.uuid4(),
                    family_id=family_id,
                    token_hash=hash_refresh_token(new_raw),
                    expires_at=self._expiry(),
                )
            )
            await db.commit()
            return IssuedSession(
                access_token=self._tokens.issue(user_id=user_id, jkt=jkt, issued_ms=issued_ms),
                refresh_token=new_raw,
                expires_in=self._tokens.ttl,
                family_id=family_id,
            )

        # Nothing consumed: classify why (row state is read after any concurrent winner).
        await db.rollback()
        result = await db.execute(
            select(
                RefreshToken.is_used,
                RefreshToken.expires_at,
                RefreshTokenFamily.is_revoked,
                RefreshTokenFamily.dpop_jkt,
                RefreshTokenFamily.user_id,
            )
            .join(RefreshTokenFamily, RefreshTokenFamily.id == RefreshToken.family_id)
            .where(RefreshToken.token_hash == token_hash)
        )
        state = result.one_or_none()
        if state is None:
            await db.rollback()
            raise RefreshError(RefreshOutcome.INVALID)
        is_used, expires_at, is_revoked, family_jkt, user_id = state
        if is_used:
            await self.revoke_all_for_user(db, user_id, reason="reuse_detected")
            await db.commit()
            raise RefreshError(RefreshOutcome.REUSE)
        await db.rollback()
        if is_revoked:
            raise RefreshError(RefreshOutcome.REVOKED)
        if expires_at <= datetime.now(UTC):
            raise RefreshError(RefreshOutcome.EXPIRED)
        if family_jkt != jkt:
            raise RefreshError(RefreshOutcome.KEY_MISMATCH)
        raise RefreshError(RefreshOutcome.INVALID)  # pragma: no cover - lost race edge

    async def revoke_all_for_user(
        self, db: AsyncSession, user_id: uuid.UUID, *, reason: str
    ) -> None:
        """Revoke EVERY family of the user and kill already-issued access tokens (D-A7)."""
        await db.execute(
            update(RefreshTokenFamily)
            .where(RefreshTokenFamily.user_id == user_id, RefreshTokenFamily.is_revoked.is_(False))
            .values(is_revoked=True, revoked_reason=reason)
            .execution_options(synchronize_session=False)
        )
        await self._mark_revoked(USER_REVOKED_AFTER_MS.format(user_id))

    async def kill_user_access_tokens_after_commit(self, user_id: uuid.UUID) -> None:
        """Google takeover (email verification AGGIUNTA): called AFTER the transaction that
        revoked every family of the user has COMMITTED. Moves the user marker to "now", so
        any access token whose refresh consume ran before that commit is dead (a consume
        after it cannot succeed: the family is revoked), then waits until the shared Redis
        clock has passed the marker, so the session created next for the legitimate owner
        is not caught by the same-millisecond fail-closed rule."""
        marker = int(
            await self._mark_script(
                keys=[USER_REVOKED_AFTER_MS.format(user_id)], args=[self.access_ttl + 5]
            )
        )
        for _ in range(1000):  # normally 0-2 iterations (1 ms resolution)
            if await self.clock_ms() > marker:
                return
            await asyncio.sleep(0.001)
        raise RuntimeError("Redis clock did not advance")  # pragma: no cover

    async def logout(self, db: AsyncSession, *, raw: str, jkt: str) -> bool:
        """Revoke the family of ``raw``. Returns False when the DPoP key does not match.
        Unknown tokens are treated as already logged out (idempotent)."""
        if not is_well_formed_refresh_token(raw):
            return True
        result = await db.execute(
            select(RefreshTokenFamily.id, RefreshTokenFamily.dpop_jkt)
            .join(RefreshToken, RefreshToken.family_id == RefreshTokenFamily.id)
            .where(RefreshToken.token_hash == hash_refresh_token(raw))
        )
        row = result.one_or_none()
        if row is None:
            return True
        family_id, family_jkt = row
        if family_jkt != jkt:
            return False
        await db.execute(
            update(RefreshTokenFamily)
            .where(RefreshTokenFamily.id == family_id, RefreshTokenFamily.is_revoked.is_(False))
            .values(is_revoked=True, revoked_reason="logout")
            .execution_options(synchronize_session=False)
        )
        await db.commit()
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

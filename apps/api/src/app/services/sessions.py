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
serialise refreshes with Web Locks (spec §6.4)."""

from __future__ import annotations

import enum
import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken, RefreshTokenFamily, User
from app.security.tokens import AccessTokenService, hash_refresh_token, new_refresh_token

_REFRESH_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

USER_REVOKED_AFTER = "user_revoked_after:{}"
JKT_REVOKED_AFTER = "jkt_revoked_after:{}"


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

    @property
    def access_ttl(self) -> int:
        return self._tokens.ttl

    def _expiry(self) -> datetime:
        return datetime.now(UTC) + timedelta(seconds=self._refresh_ttl)

    async def create_session(
        self, db: AsyncSession, *, user_id: uuid.UUID, jkt: str
    ) -> IssuedSession:
        """New family bound to the DPoP key + first refresh token. Caller commits."""
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
            access_token=self._tokens.issue(user_id=user_id, jkt=jkt),
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
                access_token=self._tokens.issue(user_id=user_id, jkt=jkt),
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
        await self._redis.set(
            USER_REVOKED_AFTER.format(user_id), str(int(time.time())), ex=self.access_ttl + 5
        )

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
        await self._redis.set(
            JKT_REVOKED_AFTER.format(jkt), str(int(time.time())), ex=self.access_ttl + 5
        )
        return True

    async def is_access_token_revoked(self, *, user_id: uuid.UUID, jkt: str, iat: int) -> bool:
        user_marker, jkt_marker = await self._redis.mget(
            USER_REVOKED_AFTER.format(user_id), JKT_REVOKED_AFTER.format(jkt)
        )
        for marker in (user_marker, jkt_marker):
            if marker is not None and iat <= int(marker):
                return True
        return False

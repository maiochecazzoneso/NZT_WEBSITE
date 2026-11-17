"""Email verification tokens (AGGIUNTA, closes review M2 together with the Google
takeover rule in routers/google.py).

* token = ``secrets.token_urlsafe(32)`` (256 bit), only ``sha256(token)`` hex is stored;
* single use (``used_at``), TTL ``NZT_EMAIL_VERIFICATION_TTL_SECONDS`` (default 24 h);
* issuing a new token deletes the user's previous PENDING tokens; consuming one deletes
  the other pending tokens; the Google takeover deletes them all;
* the link carries the token in the URL FRAGMENT (``/verifica-email#token=...``), so it
  never reaches server access logs or a ``Referer`` header.

Lock order everywhere: ``users`` row first, then ``email_verification_tokens`` (same order
as the Google takeover), so verify/takeover cannot deadlock."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import EmailVerificationToken, User
from app.services.mailer import Mailer, OutgoingEmail

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

SUBJECT = "Conferma il tuo indirizzo email - Area Clienti NZT Solutions"


def new_verification_token() -> str:
    return secrets.token_urlsafe(32)


def hash_verification_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("ascii", errors="strict")).hexdigest()


def is_well_formed_token(raw: str) -> bool:
    return _TOKEN_RE.fullmatch(raw) is not None


async def invalidate_pending_tokens(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        delete(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user_id,
            EmailVerificationToken.used_at.is_(None),
        )
        .execution_options(synchronize_session=False)
    )


async def issue_verification_token(
    db: AsyncSession, user_id: uuid.UUID, *, ttl_seconds: int
) -> str:
    """New pending token (previous pending ones are invalidated). Caller commits."""
    await invalidate_pending_tokens(db, user_id)
    raw = new_verification_token()
    db.add(
        EmailVerificationToken(
            id=uuid.uuid4(),
            user_id=user_id,
            token_hash=hash_verification_token(raw),
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
        )
    )
    await db.flush()
    return raw


async def consume_verification_token(db: AsyncSession, raw: str) -> uuid.UUID | None:
    """Mark the token used and the user verified. None for unknown / malformed / used /
    expired tokens (the caller answers with ONE generic error). Caller commits."""
    if not is_well_formed_token(raw):
        return None
    token_hash = hash_verification_token(raw)
    owner = await db.execute(
        select(EmailVerificationToken.user_id).where(
            EmailVerificationToken.token_hash == token_hash
        )
    )
    user_id = owner.scalar_one_or_none()
    if user_id is None:
        return None
    # users row first (see module docstring), then the conditional single-use UPDATE.
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    consumed = await db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.token_hash == token_hash,
            EmailVerificationToken.used_at.is_(None),
            EmailVerificationToken.expires_at > func.now(),
        )
        .values(used_at=func.now())
        .returning(EmailVerificationToken.user_id)
        .execution_options(synchronize_session=False)
    )
    if consumed.scalar_one_or_none() is None:
        return None
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_verified=True)
        .execution_options(synchronize_session=False)
    )
    await invalidate_pending_tokens(db, user_id)
    return user_id


def verification_email(settings: Settings, *, to: str, raw_token: str) -> OutgoingEmail:
    hours = settings.email_verification_ttl_seconds // 3600
    validity = "1 ora" if hours == 1 else f"{hours} ore"
    link = f"{settings.email_verification_page_url}#token={raw_token}"
    text = (
        "Ciao,\n\n"
        "per confermare l'indirizzo email del tuo account dell'Area Clienti NZT Solutions "
        "apri questo link:\n\n"
        f"{link}\n\n"
        f"Il link è valido per {validity} e può essere usato una sola volta.\n\n"
        "Se non hai creato tu questo account ignora questa email: non aprire il link.\n\n"
        "NZT Solutions\n"
    )
    return OutgoingEmail(to=to, subject=SUBJECT, text=text)


async def deliver(mailer: Mailer, message: OutgoingEmail) -> bool:
    """Send without ever raising; failures are logged WITHOUT recipient, body or link."""
    try:
        await mailer.send(message)
    except Exception as exc:  # never fail the caller (registration / background task)
        logger.warning("verification email delivery failed (%s)", type(exc).__name__)
        return False
    return True

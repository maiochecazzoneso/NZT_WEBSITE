"""Email verification tokens (AGGIUNTA, closes review M2 together with the Google
takeover rule in routers/google.py).

* token = ``secrets.token_urlsafe(32)`` (256 bit), only ``sha256(token)`` hex is stored;
* single use (``usedAt``), TTL ``NZT_EMAIL_VERIFICATION_TTL_SECONDS`` (default 24 h);
* issuing a new token deletes the user's previous PENDING tokens; consuming one deletes
  the other pending tokens; the Google takeover deletes them all;
* the link carries the token in the URL FRAGMENT (``/verifica-email#token=...``), so it
  never reaches server access logs or a ``Referer`` header;
* documents: ``emailVerificationTokens`` with ``_id = sha256(token)``; a TTL index
  removes them once expired.

Concurrency without transactions: consumption is ONE atomic findOneAndUpdate on the token
(``usedAt: null`` and not expired), so a token is accepted at most once. A concurrent
Google takeover (routers/google.py) is safe in either order: it only proceeds on a user
still ``isVerified: false`` (atomic condition on the user document) and it deletes the
pending tokens itself."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import uuid
from datetime import timedelta

from app.config import Settings
from app.db import Collections, utcnow
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


async def invalidate_pending_tokens(db: Collections, user_id: uuid.UUID) -> None:
    await db.email_tokens.delete_many({"userId": user_id, "usedAt": None})


async def issue_verification_token(db: Collections, user_id: uuid.UUID, *, ttl_seconds: int) -> str:
    """New pending token (previous pending ones are invalidated)."""
    await invalidate_pending_tokens(db, user_id)
    raw = new_verification_token()
    now = utcnow()
    await db.email_tokens.insert_one(
        {
            "_id": hash_verification_token(raw),
            "userId": user_id,
            "expiresAt": now + timedelta(seconds=ttl_seconds),
            "usedAt": None,
            "createdAt": now,
        }
    )
    return raw


async def consume_verification_token(db: Collections, raw: str) -> uuid.UUID | None:
    """Mark the token used and the user verified. None for unknown / malformed / used /
    expired tokens (the caller answers with ONE generic error)."""
    if not is_well_formed_token(raw):
        return None
    now = utcnow()
    token = await db.email_tokens.find_one_and_update(
        {"_id": hash_verification_token(raw), "usedAt": None, "expiresAt": {"$gt": now}},
        {"$set": {"usedAt": now}},
        projection={"userId": 1},
    )
    if token is None:
        return None
    user_id: uuid.UUID = token["userId"]
    verified = await db.users.update_one(
        {"_id": user_id}, {"$set": {"isVerified": True, "updatedAt": now}}
    )
    if verified.matched_count == 0:
        return None
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

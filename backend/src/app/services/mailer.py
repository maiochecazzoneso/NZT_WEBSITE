"""Transactional email (AGGIUNTA: email verification).

* ``ResendMailer`` - the only production backend: one POST to the fixed Resend endpoint
  (egress to api.resend.com only, no user-supplied URL), Bearer API key, bounded timeout,
  no redirects, NO automatic retries (a failure is reported to the caller, which logs it
  without the message body; the user can ask for a new email).
* ``ConsoleMailer`` / ``FileMailer`` - development and E2E only (they expose the
  verification link by design); ``Settings`` refuses them in production.
* ``MemoryMailer`` - in-process outbox for the test-suite.

No backend ever logs the recipient, the body or the link on the production path."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Final, Protocol

import httpx
from pydantic import SecretStr

from app.config import Settings

logger = logging.getLogger(__name__)

RESEND_ENDPOINT: Final = "https://api.resend.com/emails"


@dataclass(frozen=True, slots=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str


class MailDeliveryError(Exception):
    """Delivery failed. The message never contains the recipient, body or link."""


class Mailer(Protocol):
    async def send(self, message: OutgoingEmail) -> None: ...

    async def aclose(self) -> None: ...


class ResendMailer:
    def __init__(
        self,
        *,
        api_key: SecretStr,
        sender: str,
        client: httpx.AsyncClient,
        timeout_seconds: float = 10.0,
        owns_client: bool = False,
    ) -> None:
        self._api_key = api_key
        self._sender = sender
        self._client = client
        self._timeout = timeout_seconds
        self._owns_client = owns_client

    async def send(self, message: OutgoingEmail) -> None:
        try:
            response = await self._client.post(
                RESEND_ENDPOINT,
                json={
                    "from": self._sender,
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.text,
                },
                headers={"Authorization": f"Bearer {self._api_key.get_secret_value()}"},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise MailDeliveryError(f"transport error: {type(exc).__name__}") from exc
        if not 200 <= response.status_code < 300:
            raise MailDeliveryError(f"provider status {response.status_code}")

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


class ConsoleMailer:
    """DEVELOPMENT ONLY: writes the whole message (including the link) to the log."""

    async def send(self, message: OutgoingEmail) -> None:
        logger.warning(
            "DEV MAILER (never in production) to=%s subject=%s\n%s",
            message.to,
            message.subject,
            message.text,
        )

    async def aclose(self) -> None:
        return None


class FileMailer:
    """DEVELOPMENT/E2E ONLY: one JSON file (mode 0600) per message in ``directory``."""

    def __init__(self, directory: str) -> None:
        self._dir = Path(directory)

    def _write(self, message: OutgoingEmail) -> None:
        self._dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = self._dir / f"{time.time_ns()}-{uuid.uuid4().hex}.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(asdict(message), fh, ensure_ascii=False)

    async def send(self, message: OutgoingEmail) -> None:
        await asyncio.to_thread(self._write, message)

    async def aclose(self) -> None:
        return None


@dataclass
class MemoryMailer:
    """TESTS ONLY: keeps the messages in ``outbox``; ``fail=True`` simulates an outage."""

    outbox: list[OutgoingEmail] = field(default_factory=list)
    fail: bool = False

    async def send(self, message: OutgoingEmail) -> None:
        if self.fail:
            raise MailDeliveryError("simulated failure")
        self.outbox.append(message)

    async def aclose(self) -> None:
        return None


def build_mailer(
    settings: Settings,
    *,
    client: httpx.AsyncClient | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Mailer:
    backend = settings.mail_backend
    if backend == "resend":
        assert settings.resend_api_key is not None
        assert settings.mail_from is not None
        owns_client = client is None
        http_client = client or httpx.AsyncClient(
            transport=transport,
            follow_redirects=False,
            timeout=settings.mail_http_timeout_seconds,
            headers={"User-Agent": "nzt-area-api"},
        )
        return ResendMailer(
            api_key=settings.resend_api_key,
            sender=settings.mail_from,
            client=http_client,
            timeout_seconds=settings.mail_http_timeout_seconds,
            owns_client=owns_client,
        )
    if settings.is_production:  # defence in depth: Settings already refuses this
        raise RuntimeError("only the resend mail backend is allowed in production")
    if backend == "file":
        assert settings.mail_file_dir is not None
        return FileMailer(settings.mail_file_dir)
    if backend == "memory":
        return MemoryMailer()
    return ConsoleMailer()

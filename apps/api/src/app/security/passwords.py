"""Argon2id hashing (spec §4.1) + timing-attack mitigation (spec §4.2).

Hash/verify run in a worker thread (never on the event loop) and are bounded by an
asyncio.Semaphore so that a burst of logins cannot exhaust CPU/RAM (each call needs
64 MiB). See D-A9."""

from __future__ import annotations

import asyncio
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

ARGON2_MEMORY_COST_KIB = 65536
ARGON2_TIME_COST = 3
ARGON2_PARALLELISM = 4
ARGON2_SALT_LEN = 16
ARGON2_HASH_LEN = 32

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128

_DIGIT = re.compile(r"\d")
_LETTER = re.compile(r"[^\W\d_]")
_SPECIAL = re.compile(r"[^\w\s]|_")


def password_policy_errors(password: str) -> list[str]:
    """Spec §8.1: min 12 chars, special characters, digits (+ a letter, + max length cap)."""
    errors: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        errors.append(f"must be at least {PASSWORD_MIN_LENGTH} characters")
    if len(password) > PASSWORD_MAX_LENGTH:
        errors.append(f"must be at most {PASSWORD_MAX_LENGTH} characters")
    if not _DIGIT.search(password):
        errors.append("must contain at least one digit")
    if not _SPECIAL.search(password):
        errors.append("must contain at least one special character")
    if not _LETTER.search(password):
        errors.append("must contain at least one letter")
    return errors


class PasswordService:
    def __init__(self, max_concurrency: int) -> None:
        # PasswordHasher draws the salt from os.urandom(salt_len) for every hash.
        self._hasher = PasswordHasher(
            time_cost=ARGON2_TIME_COST,
            memory_cost=ARGON2_MEMORY_COST_KIB,
            parallelism=ARGON2_PARALLELISM,
            hash_len=ARGON2_HASH_LEN,
            salt_len=ARGON2_SALT_LEN,
            type=Type.ID,
        )
        self._semaphore = asyncio.Semaphore(max_concurrency)
        # Fixed dummy hash with identical parameters (spec §4.2).
        self._dummy_hash = self._hasher.hash(secrets.token_urlsafe(32))
        self.dummy_verifications = 0  # observable in tests

    @property
    def hasher(self) -> PasswordHasher:
        return self._hasher

    async def hash(self, password: str) -> str:
        async with self._semaphore:
            return await asyncio.to_thread(self._hasher.hash, password)

    def _verify_sync(self, password_hash: str, password: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    async def verify(self, password_hash: str, password: str) -> bool:
        async with self._semaphore:
            return await asyncio.to_thread(self._verify_sync, password_hash, password)

    async def dummy_verify(self, password: str) -> None:
        """Burn the same CPU/memory as a real verification; result is discarded."""
        self.dummy_verifications += 1
        await self.verify(self._dummy_hash, password)

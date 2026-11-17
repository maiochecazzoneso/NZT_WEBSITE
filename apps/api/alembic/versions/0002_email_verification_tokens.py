"""Email verification tokens (AGGIUNTA: closes the account pre-hijacking hole, review M2).

Only the SHA-256 of the token is stored. The runtime role nzt_app receives
SELECT/INSERT/UPDATE/DELETE automatically through the ALTER DEFAULT PRIVILEGES of
scripts/db/roles.sql (the table is created by nzt_migrator, like every other table).

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_verification_tokens",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("idx_email_verification_user", "email_verification_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_email_verification_user", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")

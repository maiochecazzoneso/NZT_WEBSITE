"""Initial schema - spec §3 (D-A3: download_logs.user_id nullable, ON DELETE SET NULL).

Revision ID: 0001
Revises:
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID_DEFAULT = sa.text("uuid_generate_v4()")


def _id() -> sa.Column[object]:
    return sa.Column(
        "id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=UUID_DEFAULT
    )


def _created_at() -> sa.Column[object]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.execute(sa.text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))

    op.create_table(
        "users",
        _id(),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        _created_at(),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("idx_users_email_lower", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "auth_identities",
        _id(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("provider_user_id", sa.String(255), nullable=False),
        _created_at(),
        sa.UniqueConstraint("provider", "provider_user_id"),
    )
    op.create_index("idx_identities_user_id", "auth_identities", ["user_id"])

    op.create_table(
        "refresh_token_families",
        _id(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("dpop_jkt", sa.String(255), nullable=False),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revoked_reason", sa.String(100), nullable=True),
        _created_at(),
    )
    op.create_index("idx_families_user", "refresh_token_families", ["user_id"])

    op.create_table(
        "refresh_tokens",
        _id(),
        sa.Column(
            "family_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("refresh_token_families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("is_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _created_at(),
    )
    op.create_index("idx_refresh_token_lookup", "refresh_tokens", ["token_hash"])

    op.create_table(
        "entitlements",
        _id(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("product_code", sa.String(64), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.UniqueConstraint("user_id", "product_code"),
    )
    op.create_index(
        "idx_entitlements_lookup", "entitlements", ["user_id", "product_code", "is_enabled"]
    )

    op.create_table(
        "download_logs",
        _id(),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,  # D-A3
        ),
        sa.Column("product_code", sa.String(64), nullable=False),
        sa.Column("ip_address", postgresql.INET(), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("download_token_id", sa.String(64), nullable=False),
        _created_at(),
    )
    op.create_index("idx_download_audit", "download_logs", ["user_id", sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_table("download_logs")
    op.drop_table("entitlements")
    op.drop_table("refresh_tokens")
    op.drop_table("refresh_token_families")
    op.drop_table("auth_identities")
    op.drop_table("users")
    op.execute(sa.text('DROP EXTENSION IF EXISTS "uuid-ossp"'))

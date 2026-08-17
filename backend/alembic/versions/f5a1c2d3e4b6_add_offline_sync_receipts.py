"""Add idempotent offline synchronization receipts.

Revision ID: f5a1c2d3e4b6
Revises: c7f2a9d4e6b1
Create Date: 2026-08-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f5a1c2d3e4b6"
down_revision: Union[str, Sequence[str], None] = "c7f2a9d4e6b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "offline_sync_receipts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("activity_type", sa.String(length=64), nullable=False),
        sa.Column("client_session_id", sa.String(length=128), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("server_session_id", sa.Integer(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("last_error", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "activity_type",
            "client_session_id",
            name="uq_offline_sync_receipt_owner_activity_client",
        ),
    )
    op.create_index(op.f("ix_offline_sync_receipts_id"), "offline_sync_receipts", ["id"], unique=False)
    op.create_index(op.f("ix_offline_sync_receipts_user_id"), "offline_sync_receipts", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_offline_sync_receipts_user_id"), table_name="offline_sync_receipts")
    op.drop_index(op.f("ix_offline_sync_receipts_id"), table_name="offline_sync_receipts")
    op.drop_table("offline_sync_receipts")


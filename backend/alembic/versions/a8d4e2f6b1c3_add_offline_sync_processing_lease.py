"""add offline sync processing lease

Revision ID: a8d4e2f6b1c3
Revises: f5a1c2d3e4b6
Create Date: 2026-08-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8d4e2f6b1c3"
down_revision: Union[str, None] = "f5a1c2d3e4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "offline_sync_receipts",
        sa.Column("processing_token", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "offline_sync_receipts",
        sa.Column("processing_started_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("offline_sync_receipts", "processing_started_at")
    op.drop_column("offline_sync_receipts", "processing_token")

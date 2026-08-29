"""add Drill canonical prompt

Revision ID: b4e7d9c2a6f1
Revises: a8d4e2f6b1c3
Create Date: 2026-08-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4e7d9c2a6f1"
down_revision: Union[str, None] = "a8d4e2f6b1c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "drill_sessions",
        sa.Column("canonical_prompt", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("drill_sessions", "canonical_prompt")

"""Add nullable Post-Test detailed evaluation data.

Revision ID: f2b6c8d4e9a1
Revises: e9f3a7b2c4d8
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2b6c8d4e9a1"
down_revision: Union[str, Sequence[str], None] = "e9f3a7b2c4d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("post_test_interview_sessions", sa.Column("evaluation_data", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("post_test_interview_sessions", "evaluation_data")

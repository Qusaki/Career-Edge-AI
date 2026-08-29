"""add Drill eye-contact metrics

Revision ID: d6c8e1f4a2b7
Revises: b4e7d9c2a6f1
Create Date: 2026-08-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6c8e1f4a2b7"
down_revision: Union[str, None] = "b4e7d9c2a6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "drill_sessions",
        sa.Column("score_eye_contact", sa.Float(), nullable=True),
    )
    op.add_column(
        "drill_sessions",
        sa.Column("eye_contact_samples", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("drill_sessions", "eye_contact_samples")
    op.drop_column("drill_sessions", "score_eye_contact")

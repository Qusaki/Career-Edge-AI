"""Add versioned legal consent to users, preserving legacy account access.

Revision ID: a1c9e3f7b2d4
Revises: f2b6c8d4e9a1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c9e3f7b2d4"
down_revision: Union[str, Sequence[str], None] = "f2b6c8d4e9a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("legal_consent_required_version", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("legal_consent_version", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("privacy_acknowledged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "terms_accepted_at")
    op.drop_column("users", "privacy_acknowledged_at")
    op.drop_column("users", "legal_consent_version")
    op.drop_column("users", "legal_consent_required_version")

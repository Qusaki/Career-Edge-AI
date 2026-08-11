"""add eye contact tracking

Revision ID: 7c1e9a42f6b3
Revises: 165f0273c245
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "7c1e9a42f6b3"
down_revision: Union[str, None] = "165f0273c245"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("upcoming_student_interview_sessions", sa.Column("score_eye_contact", sa.Float(), nullable=True))
    op.add_column("upcoming_student_interview_sessions", sa.Column("eye_contact_samples", sa.Integer(), nullable=True))
    op.add_column("thesis_interview_sessions", sa.Column("score_eye_contact", sa.Float(), nullable=True))
    op.add_column("thesis_interview_sessions", sa.Column("eye_contact_samples", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("thesis_interview_sessions", "eye_contact_samples")
    op.drop_column("thesis_interview_sessions", "score_eye_contact")
    op.drop_column("upcoming_student_interview_sessions", "eye_contact_samples")
    op.drop_column("upcoming_student_interview_sessions", "score_eye_contact")

"""Add adaptive practice sessions and prospective Pre-Test scoring authority.

Revision ID: c3e8a1b7d4f2
Revises: a1c9e3f7b2d4
"""

from alembic import op
import sqlalchemy as sa


revision = "c3e8a1b7d4f2"
down_revision = "a1c9e3f7b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pre_test_intro_sessions", sa.Column("scoring_authority", sa.String(64), nullable=True))
    op.add_column("pre_test_active_listening_sessions", sa.Column("scoring_authority", sa.String(64), nullable=True))
    op.create_table(
        "adaptive_practice_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_attempt_id", sa.String(128), nullable=False),
        sa.Column("target_criterion", sa.String(32), nullable=False),
        sa.Column("difficulty", sa.String(16), nullable=False),
        sa.Column("department", sa.String(16), nullable=True),
        sa.Column("scenario_category", sa.String(64), nullable=True),
        sa.Column("scenario", sa.Text(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("prompt_fingerprint", sa.String(64), nullable=True),
        sa.Column("generation_authority", sa.String(32), nullable=True),
        sa.Column("generation_version", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=True),
        *[sa.Column(f"score_{criterion}", sa.Float(), nullable=True) for criterion in (
            "vocabulary", "clarity", "grammar", "conciseness", "task_completion", "courtesy")],
        sa.Column("score_total", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.Text(), nullable=True),
        sa.Column("scoring_authority", sa.String(64), nullable=True),
        sa.Column("evaluation_version", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "client_attempt_id", name="uq_adaptive_practice_owner_attempt"),
    )
    op.create_index("ix_adaptive_practice_sessions_user_id", "adaptive_practice_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_adaptive_practice_sessions_user_id", table_name="adaptive_practice_sessions")
    op.drop_table("adaptive_practice_sessions")
    op.drop_column("pre_test_active_listening_sessions", "scoring_authority")
    op.drop_column("pre_test_intro_sessions", "scoring_authority")

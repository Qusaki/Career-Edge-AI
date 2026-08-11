"""Create the clean PostgreSQL application baseline.

Revision ID: c7f2a9d4e6b1
Revises:
Create Date: 2026-08-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7f2a9d4e6b1"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("hashed_password", sa.String(), nullable=True),
        sa.Column("firstname", sa.String(), server_default="", nullable=False),
        sa.Column("middlename", sa.String(), nullable=True),
        sa.Column("lastname", sa.String(), server_default="", nullable=False),
        sa.Column("department", sa.String(), server_default="CCIT", nullable=False),
        sa.Column("profile_picture_url", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)

    op.create_table(
        "upcoming_student_interview_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("score_technical", sa.Float(), nullable=True),
        sa.Column("score_problem_solving", sa.Float(), nullable=True),
        sa.Column("score_coding", sa.Float(), nullable=True),
        sa.Column("score_communication", sa.Float(), nullable=True),
        sa.Column("score_soft_skills", sa.Float(), nullable=True),
        sa.Column("score_eye_contact", sa.Float(), nullable=True),
        sa.Column("eye_contact_samples", sa.Integer(), nullable=True),
        sa.Column("score_cte_subject_matter", sa.Float(), nullable=True),
        sa.Column("score_cte_teaching", sa.Float(), nullable=True),
        sa.Column("score_cte_communication", sa.Float(), nullable=True),
        sa.Column("score_cte_motivation", sa.Float(), nullable=True),
        sa.Column("score_cte_academic", sa.Float(), nullable=True),
        sa.Column("score_cte_problem_solving", sa.Float(), nullable=True),
        sa.Column("score_cte_leadership", sa.Float(), nullable=True),
        sa.Column("score_cbapa_business", sa.Float(), nullable=True),
        sa.Column("score_cbapa_analytical", sa.Float(), nullable=True),
        sa.Column("score_cbapa_communication", sa.Float(), nullable=True),
        sa.Column("score_cbapa_entrepreneurial", sa.Float(), nullable=True),
        sa.Column("score_cbapa_academic", sa.Float(), nullable=True),
        sa.Column("score_cbapa_leadership", sa.Float(), nullable=True),
        sa.Column("score_cbapa_ethical", sa.Float(), nullable=True),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_upcoming_student_interview_sessions_id"),
        "upcoming_student_interview_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "thesis_interview_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("score_ccit_technical_innovation", sa.Float(), nullable=True),
        sa.Column("score_ccit_system_implementation", sa.Float(), nullable=True),
        sa.Column("score_ccit_experimental_validation", sa.Float(), nullable=True),
        sa.Column("score_ccit_literature_review", sa.Float(), nullable=True),
        sa.Column("score_ccit_demo_quality", sa.Float(), nullable=True),
        sa.Column("score_eye_contact", sa.Float(), nullable=True),
        sa.Column("eye_contact_samples", sa.Integer(), nullable=True),
        sa.Column("score_cte_pedagogical_innovation", sa.Float(), nullable=True),
        sa.Column("score_cte_action_research", sa.Float(), nullable=True),
        sa.Column("score_cte_learning_outcomes", sa.Float(), nullable=True),
        sa.Column("score_cte_literature_alignment", sa.Float(), nullable=True),
        sa.Column("score_cte_teaching_demo", sa.Float(), nullable=True),
        sa.Column("score_cte_scalability_policy", sa.Float(), nullable=True),
        sa.Column("score_cbapa_research_problem", sa.Float(), nullable=True),
        sa.Column("score_cbapa_methodology_analysis", sa.Float(), nullable=True),
        sa.Column("score_cbapa_practical_roi", sa.Float(), nullable=True),
        sa.Column("score_cbapa_literature_theoretical", sa.Float(), nullable=True),
        sa.Column("score_cbapa_professional_delivery", sa.Float(), nullable=True),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.Column("abstract_s3_key", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_thesis_interview_sessions_id"),
        "thesis_interview_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "pre_test_intro_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("score_clarity", sa.Integer(), nullable=True),
        sa.Column("score_completeness", sa.Integer(), nullable=True),
        sa.Column("score_courtesy", sa.Integer(), nullable=True),
        sa.Column("score_correctness", sa.Integer(), nullable=True),
        sa.Column("score_conciseness", sa.Integer(), nullable=True),
        sa.Column("score_vocabulary", sa.Integer(), nullable=True),
        sa.Column("score_grammar", sa.Integer(), nullable=True),
        sa.Column("score_eye_contact", sa.Integer(), nullable=True),
        sa.Column("eye_contact_samples", sa.Integer(), nullable=True),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.Column("transcript", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pre_test_intro_sessions_id"),
        "pre_test_intro_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "pre_test_active_listening_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("score_vocabulary", sa.Integer(), nullable=True),
        sa.Column("score_clarity", sa.Integer(), nullable=True),
        sa.Column("score_eye_contact", sa.Integer(), nullable=True),
        sa.Column("eye_contact_samples", sa.Integer(), nullable=True),
        sa.Column("score_grammar", sa.Integer(), nullable=True),
        sa.Column("score_courtesy", sa.Integer(), nullable=True),
        sa.Column("score_conciseness", sa.Integer(), nullable=True),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pre_test_active_listening_sessions_id"),
        "pre_test_active_listening_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "post_test_interview_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("score_vocabulary", sa.Integer(), nullable=True),
        sa.Column("score_clarity", sa.Integer(), nullable=True),
        sa.Column("score_eye_contact", sa.Integer(), nullable=True),
        sa.Column("eye_contact_samples", sa.Integer(), nullable=True),
        sa.Column("score_grammar", sa.Integer(), nullable=True),
        sa.Column("score_courtesy", sa.Integer(), nullable=True),
        sa.Column("score_conciseness", sa.Integer(), nullable=True),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_post_test_interview_sessions_id"),
        "post_test_interview_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "drill_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("drill_level", sa.String(), nullable=False),
        sa.Column("drill_type", sa.String(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.Column("evaluation_data", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_drill_sessions_id"),
        "drill_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "custom_skills_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("targeted_skills", sa.String(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("feedback_summary", sa.String(), nullable=True),
        sa.Column("evaluation_data", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_custom_skills_sessions_id"),
        "custom_skills_sessions",
        ["id"],
        unique=False,
    )

    op.create_table(
        "upcoming_student_interview_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["upcoming_student_interview_sessions.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_upcoming_student_interview_messages_id"),
        "upcoming_student_interview_messages",
        ["id"],
        unique=False,
    )

    op.create_table(
        "thesis_interview_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["thesis_interview_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_thesis_interview_messages_id"),
        "thesis_interview_messages",
        ["id"],
        unique=False,
    )

    op.create_table(
        "pre_test_active_listening_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["pre_test_active_listening_sessions.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pre_test_active_listening_messages_id"),
        "pre_test_active_listening_messages",
        ["id"],
        unique=False,
    )

    op.create_table(
        "post_test_interview_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["post_test_interview_sessions.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_post_test_interview_messages_id"),
        "post_test_interview_messages",
        ["id"],
        unique=False,
    )

    op.create_table(
        "custom_skills_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.String(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["custom_skills_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_custom_skills_messages_id"),
        "custom_skills_messages",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("custom_skills_messages")
    op.drop_table("post_test_interview_messages")
    op.drop_table("pre_test_active_listening_messages")
    op.drop_table("thesis_interview_messages")
    op.drop_table("upcoming_student_interview_messages")

    op.drop_table("custom_skills_sessions")
    op.drop_table("drill_sessions")
    op.drop_table("post_test_interview_sessions")
    op.drop_table("pre_test_active_listening_sessions")
    op.drop_table("pre_test_intro_sessions")
    op.drop_table("thesis_interview_sessions")
    op.drop_table("upcoming_student_interview_sessions")
    op.drop_table("users")

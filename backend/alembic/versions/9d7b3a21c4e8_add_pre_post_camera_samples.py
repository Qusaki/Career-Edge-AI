"""add Pre-Test and Post-Test camera sample counts

Revision ID: 9d7b3a21c4e8
Revises: 7c1e9a42f6b3
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9d7b3a21c4e8"
down_revision: Union[str, None] = "7c1e9a42f6b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CAMERA_TABLES = (
    "pre_test_intro_sessions",
    "pre_test_active_listening_sessions",
    "post_test_interview_sessions",
)


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    existing_tables = set(inspector.get_table_names())

    for table_name in CAMERA_TABLES:
        if table_name not in existing_tables:
            continue
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "eye_contact_samples" not in existing_columns:
            op.add_column(table_name, sa.Column("eye_contact_samples", sa.Integer(), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    existing_tables = set(inspector.get_table_names())

    for table_name in reversed(CAMERA_TABLES):
        if table_name not in existing_tables:
            continue
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "eye_contact_samples" in existing_columns:
            op.drop_column(table_name, "eye_contact_samples")

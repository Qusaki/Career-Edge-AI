"""add explicit Who Am I vocabulary and grammar scores

Revision ID: 4e8c2f71b6a0
Revises: 9d7b3a21c4e8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4e8c2f71b6a0"
down_revision: Union[str, None] = "9d7b3a21c4e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    table_name = "pre_test_intro_sessions"
    if table_name not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if "score_vocabulary" not in existing_columns:
        op.add_column(table_name, sa.Column("score_vocabulary", sa.Integer(), nullable=True))
    if "score_grammar" not in existing_columns:
        op.add_column(table_name, sa.Column("score_grammar", sa.Integer(), nullable=True))

    # Preserve historical usefulness: normalize the closest original 1-3
    # rubric criteria to 1-5 only when the new fields have no value.
    op.execute(sa.text(
        "UPDATE pre_test_intro_sessions "
        "SET score_vocabulary = ROUND(score_completeness * 5.0 / 3.0) "
        "WHERE score_vocabulary IS NULL AND score_completeness IS NOT NULL"
    ))
    op.execute(sa.text(
        "UPDATE pre_test_intro_sessions "
        "SET score_grammar = ROUND(score_correctness * 5.0 / 3.0) "
        "WHERE score_grammar IS NULL AND score_correctness IS NOT NULL"
    ))


def downgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    table_name = "pre_test_intro_sessions"
    if table_name not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if "score_grammar" in existing_columns:
        op.drop_column(table_name, "score_grammar")
    if "score_vocabulary" in existing_columns:
        op.drop_column(table_name, "score_vocabulary")

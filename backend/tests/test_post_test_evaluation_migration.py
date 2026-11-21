"""Exercise the additive Post-Test revision against disposable in-memory SQLite."""

import importlib.util
from pathlib import Path
import unittest

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, inspect

from models.post_test_interview import PostTestInterviewSession


class PostTestEvaluationMigrationTests(unittest.TestCase):
    def test_nullable_json_column_upgrades_and_downgrades_without_other_changes(self):
        path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "f2b6c8d4e9a1_add_post_test_evaluation_data.py"
        spec = importlib.util.spec_from_file_location("post_test_evaluation_revision", path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(revision)
        self.assertEqual(revision.down_revision, "e9f3a7b2c4d8")

        engine = create_engine("sqlite:///:memory:")
        try:
            with engine.begin() as connection:
                Table("post_test_interview_sessions", MetaData(), Column("id", Integer, primary_key=True)).create(connection)
                revision.op = Operations(MigrationContext.configure(connection))
                revision.upgrade()
                columns = {column["name"]: column for column in inspect(connection).get_columns("post_test_interview_sessions")}
                self.assertEqual(set(columns), {"id", "evaluation_data"})
                self.assertTrue(columns["evaluation_data"]["nullable"])
                self.assertEqual(columns["evaluation_data"]["type"].__class__.__name__.lower(), "json")
                self.assertEqual(PostTestInterviewSession.__table__.c.evaluation_data.type.__class__.__name__.lower(), "json")
                revision.downgrade()
                self.assertEqual(
                    {column["name"] for column in inspect(connection).get_columns("post_test_interview_sessions")},
                    {"id"},
                )
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()

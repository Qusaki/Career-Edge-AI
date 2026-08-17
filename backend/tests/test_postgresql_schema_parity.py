import os
import re
import unittest
from unittest.mock import patch

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.engine import make_url


EXPECTED_REVISION = "a8d4e2f6b1c3"
EXPECTED_TABLES = {
    "custom_skills_messages",
    "custom_skills_sessions",
    "drill_sessions",
    "offline_sync_receipts",
    "post_test_interview_messages",
    "post_test_interview_sessions",
    "pre_test_active_listening_messages",
    "pre_test_active_listening_sessions",
    "pre_test_intro_sessions",
    "thesis_interview_messages",
    "thesis_interview_sessions",
    "upcoming_student_interview_messages",
    "upcoming_student_interview_sessions",
    "users",
}
THESIS_SCORING_COLUMNS = {
    "score_ccit_technical_innovation",
    "score_ccit_system_implementation",
    "score_ccit_experimental_validation",
    "score_ccit_literature_review",
    "score_ccit_demo_quality",
    "score_cte_pedagogical_innovation",
    "score_cte_action_research",
    "score_cte_learning_outcomes",
    "score_cte_literature_alignment",
    "score_cte_teaching_demo",
    "score_cte_scalability_policy",
    "score_cbapa_research_problem",
    "score_cbapa_methodology_analysis",
    "score_cbapa_practical_roi",
    "score_cbapa_literature_theoretical",
    "score_cbapa_professional_delivery",
}
OBSOLETE_THESIS_COLUMNS = {
    "score_technical",
    "score_problem_solving",
    "score_coding",
    "score_communication",
    "score_soft_skills",
}
EYE_CONTACT_COLUMNS = {
    "upcoming_student_interview_sessions": {
        "score_eye_contact": "float",
        "eye_contact_samples": "integer",
    },
    "thesis_interview_sessions": {
        "score_eye_contact": "float",
        "eye_contact_samples": "integer",
    },
    "pre_test_intro_sessions": {
        "score_eye_contact": "integer",
        "eye_contact_samples": "integer",
    },
    "pre_test_active_listening_sessions": {
        "score_eye_contact": "integer",
        "eye_contact_samples": "integer",
    },
    "post_test_interview_sessions": {
        "score_eye_contact": "integer",
        "eye_contact_samples": "integer",
    },
}


def _type_family(type_: sa.types.TypeEngine) -> str:
    if isinstance(type_, sa.Boolean):
        return "boolean"
    if isinstance(type_, sa.Integer):
        return "integer"
    if isinstance(type_, sa.Float):
        return "float"
    if isinstance(type_, sa.DateTime):
        return "datetime"
    if isinstance(type_, sa.String):
        return "string"
    return type(type_).__name__.lower()


def _server_default(column: sa.Column) -> str | None:
    if column.server_default is None:
        return None
    value = str(column.server_default.arg).strip()
    value = re.sub(r"::(?:character varying|text)$", "", value)
    while value.startswith("(") and value.endswith(")"):
        value = value[1:-1].strip()
    if len(value) >= 2 and value[0] == value[-1] == "'":
        value = value[1:-1].replace("''", "'")
    return value


def _foreign_keys(table: sa.Table) -> set[tuple[tuple[str, ...], tuple[str, ...]]]:
    return {
        (
            tuple(column.name for column in constraint.columns),
            tuple(element.target_fullname for element in constraint.elements),
        )
        for constraint in table.foreign_key_constraints
    }


def _unique_constraints(table: sa.Table) -> set[tuple[str, ...]]:
    return {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }


def _indexes(table: sa.Table) -> set[tuple[str, tuple[str, ...], bool]]:
    return {
        (
            index.name or "",
            tuple(column.name for column in index.columns),
            bool(index.unique),
        )
        for index in table.indexes
    }


@unittest.skipUnless(
    os.getenv("POSTGRES_PARITY_DATABASE_URL"),
    "POSTGRES_PARITY_DATABASE_URL is required for PostgreSQL parity tests.",
)
class PostgreSQLSchemaParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_url = os.environ["POSTGRES_PARITY_DATABASE_URL"]
        parsed_url = make_url(cls.database_url)
        if parsed_url.host not in {"127.0.0.1", "localhost"}:
            raise RuntimeError("Parity tests require an isolated loopback PostgreSQL host.")
        if parsed_url.port != 55432:
            raise RuntimeError("Parity tests require the isolated host port 55432.")
        if parsed_url.database != "career_edge_parity":
            raise RuntimeError("Parity tests require the career_edge_parity database.")
        if parsed_url.username != "career_edge_test":
            raise RuntimeError("Parity tests require the career_edge_test user.")

        with patch.dict(os.environ, {"DATABASE_URL": cls.database_url}):
            from models import Base

        cls.model_metadata = Base.metadata
        cls.engine = sa.create_engine(cls.database_url)
        cls.reflected_metadata = sa.MetaData()
        cls.reflected_metadata.reflect(bind=cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.dispose()

    def test_revision_and_application_table_inventory(self) -> None:
        reflected_tables = set(self.reflected_metadata.tables) - {"alembic_version"}
        self.assertSetEqual(reflected_tables, EXPECTED_TABLES)

        with self.engine.connect() as connection:
            revision = connection.execute(
                sa.text("SELECT version_num FROM alembic_version")
            ).scalar_one()
        self.assertEqual(revision, EXPECTED_REVISION)

    def test_tables_columns_types_nullability_defaults_and_keys_match(self) -> None:
        for table_name in sorted(EXPECTED_TABLES):
            expected = self.model_metadata.tables[table_name]
            actual = self.reflected_metadata.tables[table_name]

            with self.subTest(table=table_name, category="columns"):
                self.assertSetEqual(set(actual.columns.keys()), set(expected.columns.keys()))

            for column_name in expected.columns.keys():
                expected_column = expected.columns[column_name]
                actual_column = actual.columns[column_name]
                with self.subTest(table=table_name, column=column_name):
                    self.assertEqual(
                        _type_family(actual_column.type),
                        _type_family(expected_column.type),
                    )
                    self.assertEqual(actual_column.nullable, expected_column.nullable)
                    if not expected_column.primary_key:
                        self.assertEqual(
                            _server_default(actual_column),
                            _server_default(expected_column),
                        )

            with self.subTest(table=table_name, category="primary_key"):
                self.assertEqual(
                    tuple(column.name for column in actual.primary_key.columns),
                    tuple(column.name for column in expected.primary_key.columns),
                )
            with self.subTest(table=table_name, category="foreign_keys"):
                self.assertSetEqual(_foreign_keys(actual), _foreign_keys(expected))
            with self.subTest(table=table_name, category="unique_constraints"):
                self.assertSetEqual(
                    _unique_constraints(actual),
                    _unique_constraints(expected),
                )
            with self.subTest(table=table_name, category="indexes"):
                self.assertSetEqual(_indexes(actual), _indexes(expected))

    def test_thesis_uses_only_current_program_scoring_columns(self) -> None:
        columns = set(
            self.reflected_metadata.tables["thesis_interview_sessions"].columns.keys()
        )
        self.assertTrue(THESIS_SCORING_COLUMNS.issubset(columns))
        self.assertSetEqual(columns & OBSOLETE_THESIS_COLUMNS, set())

    def test_eye_contact_columns_match_expected_types_and_nullability(self) -> None:
        for table_name, expected_columns in EYE_CONTACT_COLUMNS.items():
            table = self.reflected_metadata.tables[table_name]
            for column_name, expected_type in expected_columns.items():
                with self.subTest(table=table_name, column=column_name):
                    column = table.columns[column_name]
                    self.assertEqual(_type_family(column.type), expected_type)
                    self.assertTrue(column.nullable)

    def test_alembic_autogenerate_reports_no_schema_differences(self) -> None:
        with self.engine.connect() as connection:
            migration_context = MigrationContext.configure(
                connection,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                },
            )
            differences = compare_metadata(migration_context, self.model_metadata)
        self.assertEqual(differences, [])


if __name__ == "__main__":
    unittest.main()

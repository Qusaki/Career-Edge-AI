import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


EXPECTED_TABLES = {
    "custom_skills_messages",
    "custom_skills_sessions",
    "drill_sessions",
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


class AlembicMetadataRegistrationTests(unittest.TestCase):
    def test_central_model_registry_registers_every_application_table(self):
        backend_root = Path(__file__).resolve().parents[1]
        environment = os.environ.copy()
        environment["DATABASE_URL"] = "sqlite:///:memory:"
        script = (
            "import json, sys; "
            "from models import Base; "
            "assert 'main' not in sys.modules; "
            "print(json.dumps(sorted(Base.metadata.tables)))"
        )

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=backend_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertSetEqual(set(json.loads(result.stdout)), EXPECTED_TABLES)


if __name__ == "__main__":
    unittest.main()

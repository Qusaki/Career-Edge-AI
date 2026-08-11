import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


class SchemaStartupTests(unittest.TestCase):
    def _assert_create_all_calls(self, environment_name: str, expected_calls: int) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        environment = os.environ.copy()
        environment.update({
            "DATABASE_URL": "sqlite:///:memory:",
            "ENVIRONMENT": environment_name,
            "AI_PROVIDER": "ollama",
            "AWS_EC2_METADATA_DISABLED": "true",
        })
        environment.pop("AI_API_KEY", None)

        script = """
import json
from unittest.mock import patch
from sqlalchemy import MetaData

with patch.object(MetaData, "create_all", autospec=True) as create_all:
    import main
    result = {
        "calls": create_all.call_count,
        "environment": main.settings.ENVIRONMENT,
        "permitted": main.should_auto_create_schema(main.settings.ENVIRONMENT),
    }
    print("SCHEMA_STARTUP_RESULT=" + json.dumps(result, sort_keys=True))
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=backend_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        marker = "SCHEMA_STARTUP_RESULT="
        payload_line = next(
            (line for line in result.stdout.splitlines() if line.startswith(marker)),
            None,
        )
        self.assertIsNotNone(payload_line, result.stdout)
        payload = json.loads(payload_line[len(marker):])
        self.assertEqual(payload["environment"], environment_name)
        self.assertEqual(payload["calls"], expected_calls)
        self.assertEqual(payload["permitted"], expected_calls == 1)

    def test_development_permits_create_all(self) -> None:
        self._assert_create_all_calls("development", 1)

    def test_dev_permits_create_all(self) -> None:
        self._assert_create_all_calls("dev", 1)

    def test_local_permits_create_all(self) -> None:
        self._assert_create_all_calls("local", 1)

    def test_staging_does_not_call_create_all(self) -> None:
        self._assert_create_all_calls("staging", 0)

    def test_production_does_not_call_create_all(self) -> None:
        self._assert_create_all_calls("production", 0)

    def test_unknown_environment_does_not_call_create_all(self) -> None:
        self._assert_create_all_calls("qa", 0)


if __name__ == "__main__":
    unittest.main()

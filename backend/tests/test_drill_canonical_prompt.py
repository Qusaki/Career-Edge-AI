import datetime
import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from database import Base, get_db
from models.drills import DrillSession
from models.user import User
from routers import drills


class DrillCanonicalPromptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.Session() as db:
            db.add(User(
                id=1,
                email="drill-owner@example.com",
                hashed_password="x",
                firstname="Drill",
                lastname="Owner",
                department="CCIT",
            ))
            db.commit()

        self.app = FastAPI()
        self.app.include_router(drills.router, prefix="/drills")

        def override_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        def override_user():
            with self.Session() as db:
                return db.get(User, 1)

        self.app.dependency_overrides[get_db] = override_db
        self.app.dependency_overrides[get_current_user] = override_user
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def create_session(
        self,
        *,
        drill_level: str = "easy",
        drill_type: str = "jam",
        status: str = "active",
        canonical_prompt: dict[str, object] | None = None,
    ) -> int:
        with self.Session() as db:
            session = DrillSession(
                user_id=1,
                drill_level=drill_level,
                drill_type=drill_type,
                status=status,
                canonical_prompt=canonical_prompt,
            )
            db.add(session)
            db.commit()
            db.refresh(session)
            return session.id

    def start(self, drill_level: str = "easy", drill_type: str = "jam"):
        return self.client.post(
            "/drills/start",
            json={"drill_level": drill_level, "drill_type": drill_type},
        )

    def test_fresh_prompt_is_generated_persisted_and_returned(self) -> None:
        prompt = {"topic": "Canonical teamwork"}
        with patch.object(drills, "generate_drill_prompt", return_value=prompt) as generator:
            response = self.start()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["canonical_prompt"], prompt)
        generator.assert_called_once_with("easy", "jam")
        with self.Session() as db:
            stored = db.get(DrillSession, response.json()["id"])
            self.assertEqual(stored.canonical_prompt, prompt)

    def test_repeated_starts_and_multiple_refreshes_reuse_one_prompt(self) -> None:
        prompt = {"topic": "Stable prompt"}
        with patch.object(drills, "generate_drill_prompt", return_value=prompt) as generator:
            responses = [self.start() for _ in range(4)]

        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual({response.json()["id"] for response in responses}, {responses[0].json()["id"]})
        self.assertEqual([response.json()["canonical_prompt"] for response in responses], [prompt] * 4)
        self.assertEqual(generator.call_count, 1)

    def test_legacy_active_null_prompt_is_initialized_exactly_once(self) -> None:
        legacy_id = self.create_session(canonical_prompt=None)
        prompt = {"topic": "Legacy stable prompt"}
        with patch.object(drills, "generate_drill_prompt", return_value=prompt) as generator:
            first = self.start()
            second = self.start()

        self.assertEqual(first.json()["id"], legacy_id)
        self.assertEqual(second.json()["id"], legacy_id)
        self.assertEqual(first.json()["canonical_prompt"], prompt)
        self.assertEqual(second.json()["canonical_prompt"], prompt)
        self.assertEqual(generator.call_count, 1)
        with self.Session() as db:
            self.assertEqual(db.get(DrillSession, legacy_id).canonical_prompt, prompt)

    def test_completed_historical_null_prompt_is_not_backfilled_by_listing(self) -> None:
        completed_id = self.create_session(status="completed", canonical_prompt=None)

        response = self.client.get("/drills/")

        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            self.assertIsNone(db.get(DrillSession, completed_id).canonical_prompt)

    def test_new_session_after_completion_can_generate_another_prompt(self) -> None:
        prompts = [{"topic": "First"}, {"topic": "Second"}]
        with patch.object(drills, "generate_drill_prompt", side_effect=prompts) as generator:
            first = self.start().json()
            completion = self.client.post(
                f"/drills/{first['id']}/complete",
                json={"evaluation_data": {"spoken_response": "one two three four five"}},
            )
            second = self.start().json()

        self.assertEqual(completion.status_code, 200, completion.text)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["canonical_prompt"], prompts[0])
        self.assertEqual(second["canonical_prompt"], prompts[1])
        self.assertEqual(generator.call_count, 2)

    def test_resumed_session_retains_its_persisted_level_and_type(self) -> None:
        prompt = {"sentence": "The food is here.", "emotion": "Excited"}
        session_id = self.create_session(
            drill_level="medium",
            drill_type="emotion",
            canonical_prompt=prompt,
        )

        response = self.start("medium", "emotion")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], session_id)
        self.assertEqual(response.json()["drill_level"], "medium")
        self.assertEqual(response.json()["drill_type"], "emotion")
        self.assertEqual(response.json()["canonical_prompt"], prompt)

    def test_completion_uses_server_prompt_and_ignores_conflicting_client_prompt(self) -> None:
        canonical_prompt = {"topic": "Server-owned topic"}
        session_id = self.create_session(canonical_prompt=canonical_prompt)

        response = self.client.post(
            f"/drills/{session_id}/complete",
            json={
                "evaluation_data": {
                    "prompt": {"topic": "Client replacement"},
                    "spoken_response": "one two three four five",
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            stored = db.get(DrillSession, session_id)
            self.assertEqual(stored.canonical_prompt, canonical_prompt)
            self.assertEqual(json.loads(stored.evaluation_data)["prompt"], canonical_prompt)

    def test_negotiation_prompt_is_session_scoped_and_stable(self) -> None:
        first = self.start("hard", "negotiation")
        second = self.start("hard", "negotiation")

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(first.json()["canonical_prompt"], second.json()["canonical_prompt"])
        self.assertIn("scenario", first.json()["canonical_prompt"])
        self.assertIn("instruction", first.json()["canonical_prompt"])


if __name__ == "__main__":
    unittest.main()

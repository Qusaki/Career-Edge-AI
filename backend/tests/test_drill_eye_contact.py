import unittest

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


class DrillEyeContactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.Session() as db:
            db.add_all([
                User(id=1, email="owner@example.com", hashed_password="x", firstname="Drill", lastname="Owner", department="CCIT"),
                User(id=2, email="other@example.com", hashed_password="x", firstname="Other", lastname="User", department="CCIT"),
            ])
            db.commit()

        self.current_user_id = 1
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
                return db.get(User, self.current_user_id)

        self.app.dependency_overrides[get_db] = override_db
        self.app.dependency_overrides[get_current_user] = override_user
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def create_session(
        self,
        *,
        user_id: int = 1,
        drill_level: str = "easy",
        drill_type: str = "jam",
        canonical_prompt: dict | None = None,
    ) -> DrillSession:
        with self.Session() as db:
            session = DrillSession(
                user_id=user_id,
                drill_level=drill_level,
                drill_type=drill_type,
                canonical_prompt=canonical_prompt or {"topic": "Stable camera prompt"},
            )
            db.add(session)
            db.commit()
            db.refresh(session)
            return session

    def complete(self, session_id: int | str, **camera):
        return self.client.post(
            f"/drills/{session_id}/complete",
            json={
                "evaluation_data": {"spoken_response": "one two three four five"},
                **camera,
            },
        )

    def test_completion_persists_and_exposes_eye_contact_without_changing_score_or_prompt(self) -> None:
        session = self.create_session()

        response = self.complete(session.id, eye_contact_score=80, eye_contact_samples=20)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["score_eye_contact"], 80)
        self.assertEqual(response.json()["eye_contact_samples"], 20)
        self.assertEqual(response.json()["score"], 50.0)
        self.assertEqual(response.json()["canonical_prompt"], {"topic": "Stable camera prompt"})
        with self.Session() as db:
            stored = db.get(DrillSession, session.id)
            self.assertEqual(stored.score_eye_contact, 80)
            self.assertEqual(stored.eye_contact_samples, 20)

    def test_zero_percent_with_positive_samples_is_valid(self) -> None:
        session = self.create_session()

        response = self.complete(session.id, eye_contact_score=0, eye_contact_samples=20)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["score_eye_contact"], 0)
        self.assertEqual(response.json()["eye_contact_samples"], 20)

    def test_no_samples_produces_no_measurement(self) -> None:
        session = self.create_session()

        response = self.complete(session.id, eye_contact_score=80, eye_contact_samples=0)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["score_eye_contact"])
        self.assertEqual(response.json()["eye_contact_samples"], 0)

    def test_fake_profile_completion_persists_numeric_camera_fields(self) -> None:
        session = self.create_session(
            drill_level="medium",
            drill_type="fake_profile",
            canonical_prompt={"name": "Alex", "age": 28, "job": "Engineer", "hobby": "Reading"},
        )

        response = self.complete(session.id, eye_contact_score=75, eye_contact_samples=30)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["eye_contact_samples"], 30)
        self.assertIsInstance(response.json()["eye_contact_samples"], int)
        self.assertEqual(response.json()["canonical_prompt"]["age"], 28)
        progress = self.client.get("/drills/progress").json()
        self.assertEqual(progress["medium"]["completed_types"], ["fake_profile"])

    def test_offline_uuid_in_integer_session_path_reproduces_validation_error(self) -> None:
        local_id = "7f4d6d6e-1b7a-4d28-a6c9-9c0b1d2e3f40"

        response = self.complete(local_id, eye_contact_score=75, eye_contact_samples=20)

        self.assertEqual(response.status_code, 422, response.text)
        error = response.json()["detail"][0]
        self.assertEqual(error["loc"], ["path", "session_id"])
        self.assertEqual(error["type"], "int_parsing")
        self.assertEqual(error["input"], local_id)

    def test_malformed_numeric_camera_value_is_rejected_without_completion(self) -> None:
        session = self.create_session()

        response = self.complete(session.id, eye_contact_score=75, eye_contact_samples="twenty")

        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "eye_contact_samples"])
        with self.Session() as db:
            self.assertEqual(db.get(DrillSession, session.id).status, "active")
        self.assertEqual(self.client.get("/drills/progress").json()["easy"]["completed"], 0)

    def test_camera_metric_bounds_are_rejected(self) -> None:
        invalid_metrics = [
            {"eye_contact_score": -1, "eye_contact_samples": 1},
            {"eye_contact_score": 101, "eye_contact_samples": 1},
            {"eye_contact_score": 50, "eye_contact_samples": -1},
        ]
        for metrics in invalid_metrics:
            with self.subTest(metrics=metrics):
                session = self.create_session()
                response = self.complete(session.id, **metrics)
                self.assertEqual(response.status_code, 422, response.text)

    def test_completed_session_remains_idempotent(self) -> None:
        session = self.create_session()
        first = self.complete(session.id, eye_contact_score=80, eye_contact_samples=20)
        second = self.complete(session.id, eye_contact_score=10, eye_contact_samples=5)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["score_eye_contact"], 80)
        self.assertEqual(second.json()["eye_contact_samples"], 20)

    def test_wrong_user_cannot_complete_session(self) -> None:
        session = self.create_session(user_id=2)

        response = self.complete(session.id, eye_contact_score=80, eye_contact_samples=20)

        self.assertEqual(response.status_code, 404, response.text)


if __name__ == "__main__":
    unittest.main()

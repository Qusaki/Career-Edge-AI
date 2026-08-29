import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from database import Base, get_db
from models.pre_test_intro import PreTestIntroSession
from models.user import User
from routers import pre_test_intro


def complete_payload(transcript: str) -> dict[str, object]:
    return {
        "transcript": transcript,
        "evaluation": {
            "score_clarity": 3,
            "score_completeness": 3,
            "score_courtesy": 3,
            "score_correctness": 3,
            "score_conciseness": 3,
            "score_vocabulary": 5,
            "score_grammar": 5,
            "feedback_summary": "Existing deterministic evaluation.",
            "eye_contact_score": 80,
            "eye_contact_samples": 20,
        },
    }


class IntroOnlineResumeTests(unittest.TestCase):
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
                User(id=1, email="intro-owner@example.com", hashed_password="x", firstname="Intro", lastname="Owner", department="CCIT"),
                User(id=2, email="intro-other@example.com", hashed_password="x", firstname="Other", lastname="User", department="CCIT"),
            ])
            db.commit()

        self.current_user_id = 1
        self.app = FastAPI()
        self.app.include_router(pre_test_intro.router, prefix="/pre-test-intro")

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

    def start(self):
        return self.client.post("/pre-test-intro/start")

    def persist(self, session_id: int, transcript: str):
        return self.client.put(
            f"/pre-test-intro/{session_id}/response",
            json={"transcript": transcript},
        )

    def test_fresh_session_has_no_fabricated_response(self) -> None:
        response = self.start()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "active")
        self.assertIsNone(response.json()["transcript"])

    def test_accepted_response_is_persisted_and_returned_on_start_and_get(self) -> None:
        session_id = self.start().json()["id"]
        transcript = "I am a software student who enjoys solving practical problems."

        persisted = self.persist(session_id, transcript)
        resumed = self.start()
        fetched = self.client.get(f"/pre-test-intro/{session_id}")

        self.assertEqual(persisted.status_code, 200, persisted.text)
        self.assertEqual(persisted.json()["transcript"], transcript)
        self.assertEqual(resumed.json()["id"], session_id)
        self.assertEqual(resumed.json()["transcript"], transcript)
        self.assertEqual(fetched.json()["transcript"], transcript)

    def test_retrying_the_same_response_is_idempotent(self) -> None:
        session_id = self.start().json()["id"]
        transcript = "One canonical introduction response."

        first = self.persist(session_id, transcript)
        second = self.persist(session_id, transcript)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        with self.Session() as db:
            self.assertEqual(db.query(PreTestIntroSession).count(), 1)
            self.assertEqual(db.get(PreTestIntroSession, session_id).transcript, transcript)

    def test_empty_response_is_rejected_and_not_persisted(self) -> None:
        session_id = self.start().json()["id"]

        response = self.persist(session_id, "   ")

        self.assertEqual(response.status_code, 400, response.text)
        with self.Session() as db:
            self.assertIsNone(db.get(PreTestIntroSession, session_id).transcript)

    def test_completed_session_cannot_be_rewritten(self) -> None:
        session_id = self.start().json()["id"]
        canonical = "The accepted response."
        self.persist(session_id, canonical)
        completed = self.client.post(
            f"/pre-test-intro/{session_id}/complete",
            json=complete_payload(canonical),
        )

        rewrite = self.persist(session_id, "A replacement after completion.")

        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(rewrite.status_code, 409, rewrite.text)
        with self.Session() as db:
            self.assertEqual(db.get(PreTestIntroSession, session_id).transcript, canonical)

    def test_wrong_user_cannot_read_or_persist_the_response(self) -> None:
        session_id = self.start().json()["id"]
        self.current_user_id = 2

        persisted = self.persist(session_id, "Unauthorized replacement.")
        fetched = self.client.get(f"/pre-test-intro/{session_id}")

        self.assertEqual(persisted.status_code, 404, persisted.text)
        self.assertEqual(fetched.status_code, 404, fetched.text)

    def test_completion_uses_persisted_response_and_preserves_scoring(self) -> None:
        session_id = self.start().json()["id"]
        canonical = "The server-authoritative accepted introduction."
        self.persist(session_id, canonical)

        response = self.client.post(
            f"/pre-test-intro/{session_id}/complete",
            json=complete_payload("A stale conflicting frontend response."),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["transcript"], canonical)
        self.assertEqual(body["total_score"], 15.0)
        self.assertTrue(body["passed"])
        self.assertEqual(body["score_eye_contact"], 80)
        self.assertEqual(body["eye_contact_samples"], 20)


if __name__ == "__main__":
    unittest.main()

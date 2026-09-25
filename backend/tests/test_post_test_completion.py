import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from core.drill_progression import DRILL_LEVEL_BY_TYPE
from database import Base, get_db
from models.drills import DrillSession
from models.post_test_interview import PostTestInterviewMessage, PostTestInterviewSession
from models.user import User
from routers import post_test_interview


def completion_payload(*, evaluation: dict | None = None) -> dict[str, object]:
    return {
        "conversation": [],
        "evaluation": evaluation if evaluation is not None else {
            "score_vocabulary": 4,
            "score_clarity": 4,
            "score_grammar": 4,
            "score_courtesy": 4,
            "score_conciseness": 4,
            "eye_contact_score": 80,
            "eye_contact_samples": 20,
        },
    }


class PostTestCompletionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.SessionLocal() as db:
            db.add_all([
                User(id=1, email="post-owner@example.com", hashed_password="x", firstname="Post", lastname="Owner", department="CCIT"),
                User(id=2, email="post-other@example.com", hashed_password="x", firstname="Other", lastname="User", department="CCIT"),
            ])
            db.add_all([
                DrillSession(user_id=1, drill_level=level, drill_type=drill_type, status="completed")
                for drill_type, level in DRILL_LEVEL_BY_TYPE.items()
            ])
            db.commit()

        self.current_user_id = 1
        self.app = FastAPI()
        self.app.include_router(post_test_interview.router, prefix="/post-test-interview")

        def override_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        def override_user():
            with self.SessionLocal() as db:
                return db.get(User, self.current_user_id)

        self.app.dependency_overrides[get_db] = override_db
        self.app.dependency_overrides[get_current_user] = override_user
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def create_session(self, answer_count: int, *, status: str = "active", user_id: int = 1) -> int:
        with self.SessionLocal() as db:
            session = PostTestInterviewSession(user_id=user_id, status=status)
            db.add(session)
            db.commit()
            db.refresh(session)
            db.add(PostTestInterviewMessage(session_id=session.id, role="ai", content="Question 1"))
            for answer_number in range(1, answer_count + 1):
                db.add(PostTestInterviewMessage(
                    session_id=session.id,
                    role="user",
                    content=f"Persisted answer {answer_number}",
                ))
            db.commit()
            return session.id

    def complete(self, session_id: int, *, payload: dict[str, object] | None = None):
        return self.client.post(
            f"/post-test-interview/{session_id}/complete",
            json=payload if payload is not None else completion_payload(),
        )

    def test_zero_through_four_persisted_answers_are_rejected(self) -> None:
        for answer_count in range(5):
            with self.subTest(answer_count=answer_count):
                response = self.complete(self.create_session(answer_count))
                self.assertEqual(response.status_code, 409, response.text)
                self.assertIn("all five", response.json()["detail"])

    def test_exactly_five_sparse_persisted_answers_complete_with_quality_cap(self) -> None:
        session_id = self.create_session(5)

        response = self.complete(session_id)

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["total_score"], 5.0)
        self.assertFalse(result["passed"])
        self.assertEqual(result["score_eye_contact"], 80)
        self.assertEqual(result["eye_contact_samples"], 20)

    def test_scoring_uses_delivered_questions_and_saved_answers(self) -> None:
        session_id = self.create_session(5)
        with self.SessionLocal() as db:
            for number in range(2, 6):
                db.add(PostTestInterviewMessage(session_id=session_id, role="ai", content=f"Saved question {number}"))
            db.commit()
        with patch.object(post_test_interview, "score_post_test", new_callable=AsyncMock, return_value={
            "score_vocabulary": 1, "score_clarity": 1, "score_grammar": 1,
            "score_courtesy": 1, "score_conciseness": 1,
            "feedback_summary": "These answers need more detail.",
        }) as scorer:
            response = self.complete(session_id)
        self.assertEqual(response.status_code, 200, response.text)
        scorer.assert_awaited_once_with(
            ["Question 1", "Saved question 2", "Saved question 3", "Saved question 4", "Saved question 5"],
            [f"Persisted answer {number}" for number in range(1, 6)],
        )

    def test_more_than_five_persisted_answers_require_manual_recovery(self) -> None:
        response = self.complete(self.create_session(6))

        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("manual recovery", response.json()["detail"])

    def test_completed_session_remains_idempotent(self) -> None:
        session_id = self.create_session(0, status="completed")

        first = self.complete(session_id, payload=completion_payload(evaluation={}))
        second = self.complete(session_id, payload=completion_payload(evaluation={}))

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(second.json()["status"], "completed")

    def test_expired_session_is_rejected(self) -> None:
        response = self.complete(self.create_session(5, status="expired"))

        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("expired", response.json()["detail"])

    def test_wrong_user_cannot_complete_session(self) -> None:
        session_id = self.create_session(5, user_id=1)
        self.current_user_id = 2

        response = self.complete(session_id)

        self.assertEqual(response.status_code, 404, response.text)

    def test_evaluation_remains_required(self) -> None:
        response = self.complete(self.create_session(5), payload=completion_payload(evaluation={}))

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("evaluation", response.json()["detail"].lower())

    def test_completion_uses_persisted_answers_not_submitted_conversation(self) -> None:
        session_id = self.create_session(4)
        payload = completion_payload()
        payload["conversation"] = [
            {"sender": "user", "text": f"Untrusted answer {answer_number}"}
            for answer_number in range(1, 6)
        ]

        response = self.complete(session_id, payload=payload)

        self.assertEqual(response.status_code, 409, response.text)

    def test_transaction_failure_rolls_back_completion(self) -> None:
        session_id = self.create_session(5)

        with patch.object(Session, "commit", side_effect=RuntimeError("forced commit failure")):
            response = self.complete(session_id)

        self.assertEqual(response.status_code, 500, response.text)
        with self.SessionLocal() as db:
            stored = db.get(PostTestInterviewSession, session_id)
            self.assertIsNotNone(stored)
            self.assertEqual(stored.status, "active")
            self.assertIsNone(stored.total_score)


if __name__ == "__main__":
    unittest.main()

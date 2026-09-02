import asyncio
import datetime
import json
import threading
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from database import Base, get_db
import models  # noqa: F401 - register complete metadata
from models.drills import DrillSession
from models.offline_sync import OfflineSyncReceipt
from models.pre_test_active_listening import PreTestActiveListeningSession
from models.pre_test_intro import PreTestIntroSession
from models.upcoming_student_interview import UpcomingStudentInterviewSession
from models.user import User
from routers import offline_sync
from routers.pre_test_active_listening import ACTIVE_LISTENING_PROMPTS
from routers.post_test_interview import get_post_test_questions
from services.ai_provider import AIProviderUnavailableError


class FakeProvider:
    model = "test-model"

    def __init__(self, payload: dict):
        self.payload = payload
        self.calls = 0

    async def stream_chat(self, messages, workload=None):
        self.calls += 1
        yield json.dumps(self.payload)


class FailingProvider:
    model = "test-model"

    async def stream_chat(self, messages, workload=None):
        raise AIProviderUnavailableError("provider unavailable")
        yield ""  # pragma: no cover


class BlockingProvider(FakeProvider):
    def __init__(self, payload: dict):
        super().__init__(payload)
        self.entered = threading.Event()
        self.release = threading.Event()

    async def stream_chat(self, messages, workload=None):
        self.calls += 1
        self.entered.set()
        while not self.release.is_set():
            await asyncio.sleep(0.005)
        yield json.dumps(self.payload)


def who_payload(**updates):
    payload = {
        "client_session_id": "client-who-1",
        "activity_type": "pre_test_intro",
        "question_pack_version": "pretest-who-am-i-v1",
        "answers": [{"step": 1, "text": "I am a student who enjoys building useful systems and working with teams."}],
        "conversation_log": [],
        "activity_state": {"exerciseKind": "intro"},
        "eye_contact_summary": {"score": 82, "samples": 20},
        "audio_manifest": [],
        "local_score": 100,
        "local_evaluation": {"score_clarity": 100},
        "evaluation_authority": "local_provisional",
    }
    payload.update(updates)
    return payload


class OfflineSyncEndpointTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.Session() as db:
            db.add_all([
                User(id=1, email="owner@example.com", hashed_password="x", firstname="Owner", lastname="User", department="CCIT"),
                User(id=2, email="other@example.com", hashed_password="x", firstname="Other", lastname="User", department="CCIT"),
            ])
            db.commit()

        self.app = FastAPI()
        self.app.include_router(offline_sync.router, prefix="/offline-sync")

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

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def add_completed_drills(self, *drill_types: str) -> None:
        with self.Session() as db:
            db.add_all([
                DrillSession(
                    user_id=1,
                    drill_type=drill_type,
                    drill_level="easy" if drill_type in {"jam", "fast_word"} else "medium",
                    status="completed",
                )
                for drill_type in drill_types
            ])
            db.commit()

    def test_authentication_is_required(self):
        app = FastAPI()
        app.include_router(offline_sync.router, prefix="/offline-sync")
        with TestClient(app) as client:
            response = client.post("/offline-sync", json=who_payload())
        self.assertEqual(response.status_code, 401)

    def test_pure_offline_who_am_i_creates_one_native_result_and_ignores_local_score(self):
        response = self.client.post("/offline-sync", json=who_payload())
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["evaluation_authority"], "server")
        self.assertNotEqual(body["authoritative_result"]["total_score"], 100)
        with self.Session() as db:
            sessions = db.query(PreTestIntroSession).all()
            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0].status, "completed")

    def test_identical_retry_replays_result_without_duplicate_history(self):
        first = self.client.post("/offline-sync", json=who_payload()).json()
        second = self.client.post("/offline-sync", json=who_payload(local_score=-999))
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()["idempotent_replay"])
        self.assertEqual(first["server_session_id"], second.json()["server_session_id"])
        with self.Session() as db:
            self.assertEqual(db.query(PreTestIntroSession).count(), 1)

    def test_changed_payload_for_same_key_is_conflict(self):
        self.client.post("/offline-sync", json=who_payload())
        changed = who_payload()
        changed["answers"][0]["text"] = "Materially changed answer."
        response = self.client.post("/offline-sync", json=changed)
        self.assertEqual(response.status_code, 409)

    def test_processing_duplicate_does_not_evaluate(self):
        from schemas.offline_sync import OfflineSyncRequest
        digest = offline_sync.payload_digest(OfflineSyncRequest.model_validate(who_payload()))
        with self.Session() as db:
            db.add(OfflineSyncReceipt(
                user_id=1, activity_type="pre_test_intro", client_session_id="client-who-1",
                payload_hash=digest, status="processing",
            ))
            db.commit()
        response = self.client.post("/offline-sync", json=who_payload())
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "sync_in_progress")
        self.assertTrue(response.json()["detail"]["retryable"])
        with self.Session() as db:
            self.assertEqual(db.query(PreTestIntroSession).count(), 0)

    def test_near_simultaneous_requests_run_only_one_ai_evaluator(self):
        payload = {
            "client_session_id": "concurrent-listening",
            "activity_type": "pre_test_active_listening",
            "question_pack_version": "pretest-active-listening-v1",
            "answers": [{"step": 1, "text": "A factual summary of the story."}],
            "conversation_log": [
                {"sender": "ai", "text": ACTIVE_LISTENING_PROMPTS[0]},
                {"sender": "user", "text": "A factual summary of the story."},
            ],
            "activity_state": {"exerciseKind": "active-listening"},
        }
        provider = BlockingProvider({
            "score_vocabulary": 4, "score_clarity": 4, "score_grammar": 4,
            "score_courtesy": 5, "score_conciseness": 4, "feedback_summary": "Accurate.",
        })
        first_response = []

        def run_first_request():
            first_response.append(self.client.post("/offline-sync", json=payload))

        with patch("services.offline_sync.get_ai_provider", return_value=provider):
            first_thread = threading.Thread(target=run_first_request)
            first_thread.start()
            self.assertTrue(provider.entered.wait(timeout=2))
            duplicate = self.client.post("/offline-sync", json=payload)
            provider.release.set()
            first_thread.join(timeout=2)

        self.assertFalse(first_thread.is_alive())
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["detail"]["code"], "sync_in_progress")
        self.assertEqual(first_response[0].status_code, 200, first_response[0].text)
        self.assertEqual(provider.calls, 1)
        with self.Session() as db:
            self.assertEqual(db.query(PreTestActiveListeningSession).count(), 1)
            self.assertEqual(db.query(OfflineSyncReceipt).count(), 1)

    def test_stale_processing_receipt_is_recovered_with_a_new_lease(self):
        from schemas.offline_sync import OfflineSyncRequest
        digest = offline_sync.payload_digest(OfflineSyncRequest.model_validate(who_payload()))
        stale_at = datetime.datetime.utcnow() - offline_sync.PROCESSING_STALE_AFTER - datetime.timedelta(seconds=1)
        with self.Session() as db:
            db.add(OfflineSyncReceipt(
                user_id=1,
                activity_type="pre_test_intro",
                client_session_id="client-who-1",
                payload_hash=digest,
                status="processing",
                processing_token="abandoned-lease",
                processing_started_at=stale_at,
                updated_at=stale_at,
            ))
            db.commit()

        response = self.client.post("/offline-sync", json=who_payload())
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as db:
            receipt = db.query(OfflineSyncReceipt).one()
            self.assertEqual(receipt.status, "completed")
            self.assertIsNone(receipt.processing_token)
            self.assertEqual(db.query(PreTestIntroSession).count(), 1)

    def test_completed_receipt_with_missing_native_result_is_not_recreated(self):
        first = self.client.post("/offline-sync", json=who_payload())
        self.assertEqual(first.status_code, 200, first.text)
        with self.Session() as db:
            db.query(PreTestIntroSession).delete()
            db.commit()

        replay = self.client.post("/offline-sync", json=who_payload())
        self.assertEqual(replay.status_code, 409)
        self.assertEqual(replay.json()["detail"]["code"], "receipt_result_missing")
        self.assertFalse(replay.json()["detail"]["retryable"])
        with self.Session() as db:
            self.assertEqual(db.query(PreTestIntroSession).count(), 0)
            self.assertEqual(db.query(OfflineSyncReceipt).one().status, "completed")

    def test_existing_server_session_ownership_and_activity_are_validated(self):
        with self.Session() as db:
            other = PreTestIntroSession(user_id=2)
            drill = DrillSession(id=99, user_id=1, drill_type="jam", drill_level="easy")
            db.add_all([other, drill])
            db.commit()
            other_id, drill_id = other.id, drill.id
        forbidden = self.client.post("/offline-sync", json=who_payload(
            client_session_id="ownership", server_session_id=other_id,
        ))
        self.assertEqual(forbidden.status_code, 403)
        mismatch = self.client.post("/offline-sync", json=who_payload(
            client_session_id="type-mismatch", server_session_id=drill_id,
        ))
        self.assertEqual(mismatch.status_code, 409)

    def test_unsupported_pack_and_invalid_bounds_are_rejected(self):
        unsupported = self.client.post("/offline-sync", json=who_payload(question_pack_version="old-v0"))
        self.assertEqual(unsupported.status_code, 409)
        invalid_eye = who_payload(eye_contact_summary={"score": 101, "samples": 1})
        self.assertEqual(self.client.post("/offline-sync", json=invalid_eye).status_code, 422)
        oversized = who_payload()
        oversized["answers"][0]["text"] = "x" * 8001
        self.assertEqual(self.client.post("/offline-sync", json=oversized).status_code, 422)

    def test_audio_without_required_text_is_not_synchronized(self):
        audio_only = who_payload(
            answers=[{"step": 1, "text": ""}],
            audio_manifest=[{
                "audio_id": "audio-only",
                "turn_id": "answer-1",
                "answer_index": 1,
                "mime_type": "audio/webm",
                "size_bytes": 100,
                "duration_ms": 900,
                "transcript_status": "pending",
            }],
        )
        response = self.client.post("/offline-sync", json=audio_only)
        self.assertEqual(response.status_code, 422)
        with self.Session() as db:
            self.assertEqual(db.query(OfflineSyncReceipt).count(), 0)
            self.assertEqual(db.query(PreTestIntroSession).count(), 0)

    def test_drill_is_recomputed_by_canonical_backend_scorer(self):
        self.add_completed_drills("jam")
        payload = {
            "client_session_id": "drill-client",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "one two three four five six seven eight"}],
            "conversation_log": [],
            "activity_state": {"drillType": "fast_word", "drillLevel": "easy"},
            "local_score": 1,
        }
        response = self.client.post("/offline-sync", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["authoritative_result"]["score"], 76.67)

    def test_locked_offline_drill_cannot_bypass_server_progression(self):
        payload = {
            "client_session_id": "locked-medium-drill",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "calm confident response"}],
            "conversation_log": [],
            "activity_state": {"drillType": "emotion", "drillLevel": "medium"},
        }

        response = self.client.post("/offline-sync", json=payload)

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["detail"]["code"], "drill_level_locked")
        self.assertEqual(
            response.json()["detail"]["message"],
            "Complete all Easy drills before unlocking Medium.",
        )
        with self.Session() as db:
            self.assertEqual(db.query(DrillSession).count(), 0)

    def test_offline_drill_cannot_skip_same_level_prerequisite(self):
        payload = {
            "client_session_id": "locked-fast-word-drill",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "one two three four five six seven eight"}],
            "conversation_log": [],
            "activity_state": {"drillType": "fast_word", "drillLevel": "easy"},
        }

        response = self.client.post("/offline-sync", json=payload)

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["detail"]["code"], "drill_type_locked")
        self.assertEqual(
            response.json()["detail"]["message"],
            "Complete JAM first to unlock.",
        )
        with self.Session() as db:
            self.assertEqual(db.query(DrillSession).count(), 0)

    def test_synchronized_prerequisites_allow_next_offline_level(self):
        with self.Session() as db:
            db.add_all([
                DrillSession(user_id=1, drill_type="jam", drill_level="easy", status="completed"),
                DrillSession(user_id=1, drill_type="fast_word", drill_level="easy", status="completed"),
            ])
            db.commit()
        payload = {
            "client_session_id": "unlocked-medium-drill",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "calm confident response"}],
            "conversation_log": [],
            "activity_state": {"drillType": "emotion", "drillLevel": "medium"},
        }

        response = self.client.post("/offline-sync", json=payload)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["authoritative_result"]["drill_level"], "medium")

    def test_drill_sync_applies_eye_contact_summary(self):
        self.add_completed_drills("jam")
        payload = {
            "client_session_id": "drill-camera-client",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "one two three four five six seven eight"}],
            "conversation_log": [],
            "activity_state": {"drillType": "fast_word", "drillLevel": "easy"},
            "eye_contact_summary": {"score": 80, "samples": 20},
        }

        response = self.client.post("/offline-sync", json=payload)

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["authoritative_result"]
        self.assertEqual(result["score_eye_contact"], 80)
        self.assertEqual(result["eye_contact_samples"], 20)
        with self.Session() as db:
            stored = db.get(DrillSession, response.json()["server_session_id"])
            self.assertEqual(stored.score_eye_contact, 80)
            self.assertEqual(stored.eye_contact_samples, 20)

    def test_drill_sync_preserves_valid_zero_percent_eye_contact(self):
        self.add_completed_drills("jam")
        payload = {
            "client_session_id": "drill-zero-camera-client",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "one two three four five six seven eight"}],
            "conversation_log": [],
            "activity_state": {"drillType": "fast_word", "drillLevel": "easy"},
            "eye_contact_summary": {"score": 0, "samples": 20},
        }

        response = self.client.post("/offline-sync", json=payload)

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["authoritative_result"]
        self.assertEqual(result["score_eye_contact"], 0)
        self.assertEqual(result["eye_contact_samples"], 20)

    def test_drill_sync_without_samples_produces_no_measurement(self):
        self.add_completed_drills("jam")
        payload = {
            "client_session_id": "drill-no-camera-client",
            "activity_type": "drill",
            "question_pack_version": "drills-v1",
            "answers": [{"step": 1, "text": "one two three four five six seven eight"}],
            "conversation_log": [],
            "activity_state": {"drillType": "fast_word", "drillLevel": "easy"},
            "eye_contact_summary": {"score": None, "samples": 0},
        }

        response = self.client.post("/offline-sync", json=payload)

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["authoritative_result"]
        self.assertIsNone(result["score_eye_contact"])
        self.assertEqual(result["eye_contact_samples"], 0)

    def test_post_test_is_recomputed_from_canonical_five_question_contract(self):
        questions = get_post_test_questions("CCIT")
        payload = {
            "client_session_id": "post-client",
            "activity_type": "post_test",
            "question_pack_version": "posttest-v1",
            "answers": [{"step": i, "text": f"Answer {i}"} for i in range(1, 6)],
            "conversation_log": sum(([
                {"sender": "ai", "text": question},
                {"sender": "user", "text": f"Answer {index}"},
            ] for index, question in enumerate(questions, 1)), []),
            "activity_state": {"department": "CCIT"},
            "local_score": 1,
        }
        response = self.client.post("/offline-sync", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["authoritative_result"]["total_score"], 20)

    def test_active_listening_uses_provider_and_provider_failure_is_retryable(self):
        payload = {
            "client_session_id": "listening-client",
            "activity_type": "pre_test_active_listening",
            "question_pack_version": "pretest-active-listening-v1",
            "answers": [{"step": 1, "text": "A factual summary of the story."}],
            "conversation_log": [{"sender": "ai", "text": ACTIVE_LISTENING_PROMPTS[0]}, {"sender": "user", "text": "A factual summary of the story."}],
            "activity_state": {"exerciseKind": "active-listening"},
        }
        with patch("services.offline_sync.get_ai_provider", return_value=FailingProvider()):
            failed = self.client.post("/offline-sync", json=payload)
        self.assertEqual(failed.status_code, 503)
        with self.Session() as db:
            receipt = db.query(OfflineSyncReceipt).filter_by(client_session_id="listening-client").one()
            receipt_id = receipt.id
            self.assertEqual(receipt.status, "failed")
            self.assertEqual(db.query(PreTestActiveListeningSession).count(), 0)

        provider = FakeProvider({
            "score_vocabulary": 4, "score_clarity": 4, "score_grammar": 4,
            "score_courtesy": 5, "score_conciseness": 4, "feedback_summary": "Accurate summary.",
        })
        with patch("services.offline_sync.get_ai_provider", return_value=provider):
            retried = self.client.post("/offline-sync", json=payload)
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(provider.calls, 1)
        with self.Session() as db:
            receipt = db.query(OfflineSyncReceipt).filter_by(client_session_id="listening-client").one()
            self.assertEqual(receipt.id, receipt_id)
            self.assertEqual(receipt.status, "completed")
            self.assertEqual(db.query(PreTestActiveListeningSession).count(), 1)

    def test_existing_online_enrollment_session_is_reconciled_without_duplicate(self):
        with self.Session() as db:
            session = UpcomingStudentInterviewSession(user_id=1, status="active")
            db.add(session)
            db.commit()
            session_id = session.id
        payload = {
            "client_session_id": "hybrid-enrollment",
            "activity_type": "upcoming",
            "question_pack_version": "enrollment-interview-v1",
            "server_session_id": session_id,
            "answers": [{"step": i, "text": f"Answer {i}"} for i in range(1, 6)],
            "conversation_log": sum(([{"sender": "ai", "text": f"Question {i}"}, {"sender": "user", "text": f"Answer {i}"}] for i in range(1, 6)), []),
            "activity_state": {"questionIds": ["ccit-track", "ccit-technical-fundamentals", "ccit-problem-solving", "ccit-coding-basics", "ccit-communication-soft-skills"]},
        }
        provider = FakeProvider({
            "technical_score": 80, "problem_solving_score": 80, "coding_score": 80,
            "communication_score": 80, "soft_skills_score": 80, "feedback_summary": "Good.",
        })
        with patch("services.offline_sync.get_ai_provider", return_value=provider):
            response = self.client.post("/offline-sync", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["server_session_id"], session_id)
        with self.Session() as db:
            self.assertEqual(db.query(UpcomingStudentInterviewSession).count(), 1)
            self.assertEqual(db.get(UpcomingStudentInterviewSession, session_id).status, "completed")

    def test_enrollment_and_thesis_use_provider_authority(self):
        enrollment_scores = {
            "technical_score": 80, "problem_solving_score": 80, "coding_score": 80,
            "communication_score": 80, "soft_skills_score": 80, "feedback_summary": "Good.",
        }
        enrollment_provider = FakeProvider(enrollment_scores)
        enrollment = {
            "client_session_id": "enrollment-client", "activity_type": "upcoming",
            "question_pack_version": "enrollment-interview-v1",
            "answers": [{"step": i, "text": f"Answer {i}"} for i in range(1, 6)],
            "conversation_log": sum(([{"sender": "ai", "text": f"Question {i}"}, {"sender": "user", "text": f"Answer {i}"}] for i in range(1, 6)), []),
            "activity_state": {"questionIds": ["ccit-track", "ccit-technical-fundamentals", "ccit-problem-solving", "ccit-coding-basics", "ccit-communication-soft-skills"]},
        }
        with patch("services.offline_sync.get_ai_provider", return_value=enrollment_provider):
            response = self.client.post("/offline-sync", json=enrollment)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["authoritative_result"]["total_score"], 80)

        thesis_provider = FakeProvider({
            "technical_innovation_score": 75, "system_implementation_score": 75,
            "experimental_validation_score": 75, "literature_review_score": 75,
            "demo_quality_score": 75, "feedback_summary": "Defensible.",
        })
        thesis = {
            **enrollment,
            "client_session_id": "thesis-client", "activity_type": "thesis",
            "question_pack_version": "thesis-interview-v1",
            "activity_state": {
                "questionIds": ["ccit-technical-innovation", "ccit-implementation-performance", "ccit-experimental-validation", "ccit-related-work", "ccit-demo-limitations"],
                "thesisAbstractContext": "Bounded local abstract context.",
            },
        }
        with patch("services.offline_sync.get_ai_provider", return_value=thesis_provider):
            response = self.client.post("/offline-sync", json=thesis)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["authoritative_result"]["total_score"], 75)


if __name__ == "__main__":
    unittest.main()

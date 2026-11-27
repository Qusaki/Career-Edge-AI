import importlib.util
import datetime
import asyncio
import json
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.security import create_access_token
from database import Base, get_db
from models.adaptive_practice import AdaptivePracticeSession
from models.drills import DrillSession
from models.pre_test_intro import PreTestIntroSession
from models.user import User
from routers import adaptive_practice
from services.adaptive_practice import generate_adaptive_prompt, get_adaptive_recommendation, validate_generated_prompt
from services.assessment_scoring import score_adaptive_practice


PROMPT = {"scenario_category": "explaining", "scenario": "In a software project, a teammate asks about a practical task.",
          "prompt": "Explain your plan clearly to the teammate, including one supporting detail."}
SCORES = {"vocabulary": 4.0, "clarity": 2.0, "grammar": 4.0, "conciseness": 4.0, "task_completion": 4.0, "courtesy": 4.0}
RESULT = {"criteria": SCORES, "score_total": 22.0, "passed": True,
          "feedback_summary": "You explained the task directly. Your main idea could be clearer. State it first, then support it with one concrete detail.",
          "scoring_authority": "semantic_ai_with_objective_caps"}


class AdaptivePracticeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.Session() as db:
            db.add_all([User(email="first@example.test", firstname="First", lastname="User", department="CCIT"),
                        User(email="second@example.test", firstname="Second", lastname="User", department="CTE")])
            db.commit()
            first = db.query(User).filter_by(email="first@example.test").one()
            db.add(DrillSession(user_id=first.id, drill_level="easy", drill_type="jam", status="completed", score=73.33,
                end_time=datetime.datetime.utcnow(),
                evaluation_data=json.dumps({"scoring": {"rubric_version": "drill-hybrid-v1",
                    "authority": "semantic_ai_with_objective_caps", "criteria": SCORES, "raw_score": 22.0}})))
            db.commit()
        app = FastAPI()
        app.include_router(adaptive_practice.router, prefix="/adaptive-practice")
        def override_db():
            with self.Session() as db:
                yield db
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.first_headers = {"Authorization": f"Bearer {create_access_token({'sub': 'first@example.test'})}"}
        self.second_headers = {"Authorization": f"Bearer {create_access_token({'sub': 'second@example.test'})}"}

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_recommendation_is_pure_and_authority_filter_excludes_fallback(self):
        response = self.client.get("/adaptive-practice/recommendation", headers=self.first_headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["priority_criterion"], "clarity")
        self.assertIsNone(self.client.get("/adaptive-practice/recommendation", headers=self.second_headers).json()["priority_criterion"])
        with self.Session() as db:
            first = db.query(User).filter_by(email="first@example.test").one()
            db.add(PreTestIntroSession(user_id=first.id, status="completed", score_clarity=1, scoring_authority=None))
            db.add(PreTestIntroSession(user_id=first.id, status="completed", score_clarity=1, scoring_authority="deterministic_fallback"))
            db.commit()
            profile = get_adaptive_recommendation(db, first.id)
        self.assertEqual(profile["scores"]["clarity"], 2.0)

    def test_future_semantic_pre_test_normalizes_three_point_scores(self):
        with self.Session() as db:
            second = db.query(User).filter_by(email="second@example.test").one()
            db.add(PreTestIntroSession(user_id=second.id, status="completed", end_time=datetime.datetime.utcnow(),
                scoring_authority="semantic_ai_with_objective_caps", score_clarity=1, score_courtesy=2,
                score_conciseness=3, score_vocabulary=4, score_grammar=5))
            db.commit()
            profile = get_adaptive_recommendation(db, second.id)
        self.assertEqual(profile["priority_criterion"], "clarity")
        self.assertAlmostEqual(profile["scores"]["clarity"], 1 / 3 * 5, places=2)

    def test_start_idempotency_resume_completion_ownership_and_fallback_exclusion(self):
        attempt = str(uuid.uuid4())
        generator = AsyncMock(return_value=(PROMPT, "ai_generated"))
        scorer = AsyncMock(return_value=RESULT)
        with patch("routers.adaptive_practice.generate_adaptive_prompt", generator), patch("routers.adaptive_practice.score_adaptive_practice", scorer):
            response = self.client.post("/adaptive-practice/start", headers=self.first_headers, json={"client_attempt_id": attempt})
            self.assertEqual(response.status_code, 200, response.text)
            session = response.json()
            self.assertEqual(session["prompt"], PROMPT["prompt"])
            self.assertEqual(session["generation_authority"], "ai_generated")
            self.assertEqual(generator.await_count, 1)
            again = self.client.post("/adaptive-practice/start", headers=self.first_headers, json={"client_attempt_id": attempt})
            self.assertEqual(again.json()["id"], session["id"])
            self.assertEqual(generator.await_count, 1)
            self.assertEqual(self.client.get(f"/adaptive-practice/{session['id']}", headers=self.first_headers).json()["prompt"], PROMPT["prompt"])
            self.assertEqual(self.client.get(f"/adaptive-practice/{session['id']}", headers=self.second_headers).status_code, 404)
            self.assertEqual(self.client.post(f"/adaptive-practice/{session['id']}/complete", headers=self.second_headers,
                                              json={"response_text": "Another person's response"}).status_code, 404)
            self.assertEqual(self.client.post(f"/adaptive-practice/{session['id']}/abandon", headers=self.second_headers).status_code, 404)
            completed = self.client.post(f"/adaptive-practice/{session['id']}/complete", headers=self.first_headers,
                                         json={"response_text": "This is a complete response to the prompt."})
            self.assertEqual(completed.status_code, 200, completed.text)
            self.assertEqual(completed.json()["session"]["score_clarity"], 2.0)
            self.assertEqual(scorer.await_count, 1)
            self.assertEqual(scorer.await_args.args[2], PROMPT["prompt"])
            self.assertEqual(self.client.post(f"/adaptive-practice/{session['id']}/complete", headers=self.first_headers,
                                              json={"response_text": "Repeat"}).status_code, 200)
            self.assertEqual(scorer.await_count, 1)
        with self.Session() as db:
            stored = db.get(AdaptivePracticeSession, session["id"])
            self.assertEqual(stored.generation_version, "adaptive-generation-v1")
            self.assertEqual(stored.evaluation_version, "adaptive-evaluation-v1")
            self.assertEqual(stored.prompt, PROMPT["prompt"])
            self.assertEqual(stored.scoring_authority, "semantic_ai_with_objective_caps")

    def test_no_evidence_consent_and_abandon(self):
        self.assertEqual(self.client.post("/adaptive-practice/start", headers=self.second_headers,
                                          json={"client_attempt_id": str(uuid.uuid4())}).status_code, 409)
        with self.Session() as db:
            first = db.query(User).filter_by(email="first@example.test").one()
            first.legal_consent_required_version = "2026-11-21"
            db.commit()
        self.assertEqual(self.client.get("/adaptive-practice/recommendation", headers=self.first_headers).status_code, 403)
        with self.Session() as db:
            first = db.query(User).filter_by(email="first@example.test").one()
            first.legal_consent_required_version = None
            db.commit()
        with patch("routers.adaptive_practice.generate_adaptive_prompt", new=AsyncMock(return_value=(PROMPT, "ai_generated"))):
            created = self.client.post("/adaptive-practice/start", headers=self.first_headers,
                                       json={"client_attempt_id": str(uuid.uuid4())}).json()
        self.assertEqual(self.client.post(f"/adaptive-practice/{created['id']}/abandon", headers=self.first_headers).json()["status"], "abandoned")
        self.assertEqual(self.client.get(f"/adaptive-practice/{created['id']}", headers=self.first_headers).json()["prompt"], PROMPT["prompt"])

    def test_fallback_evaluation_is_visible_but_excluded_from_future_targeting(self):
        fallback = {**RESULT, "criteria": {key: 1.0 for key in SCORES}, "score_total": 6.0,
                    "passed": False, "scoring_authority": "deterministic_fallback",
                    "feedback_summary": "Deterministic fallback: semantic assessment was unavailable."}
        with patch("routers.adaptive_practice.generate_adaptive_prompt", new=AsyncMock(return_value=(PROMPT, "deterministic_fallback"))), patch(
            "routers.adaptive_practice.score_adaptive_practice", new=AsyncMock(return_value=fallback)):
            created = self.client.post("/adaptive-practice/start", headers=self.first_headers,
                                       json={"client_attempt_id": str(uuid.uuid4())}).json()
            completed = self.client.post(f"/adaptive-practice/{created['id']}/complete", headers=self.first_headers,
                json={"response_text": "This response addresses the saved scenario."})
        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(completed.json()["session"]["scoring_authority"], "deterministic_fallback")
        self.assertEqual(completed.json()["next_recommendation"]["scores"]["clarity"], 2.0)

    def test_generation_validation_and_migration_upgrade_downgrade(self):
        self.assertEqual(validate_generated_prompt(json.dumps(PROMPT), "CCIT")["prompt"], PROMPT["prompt"])
        with self.assertRaises(ValueError):
            validate_generated_prompt(json.dumps(PROMPT), "CCIT", "courtesy")
        for invalid in ("not-json", json.dumps({**PROMPT, "prompt": ""}), json.dumps({**PROMPT, "prompt": "x" * 351}),
                        json.dumps({**PROMPT, "prompt": "The ideal answer is below."}),
                        json.dumps({**PROMPT, "prompt": "Send the plan to learner@example.com immediately."})):
            with self.assertRaises(ValueError):
                validate_generated_prompt(invalid, "CCIT")
        path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c3e8a1b7d4f2_add_adaptive_practice.py"
        spec = importlib.util.spec_from_file_location("adaptive_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        engine = create_engine("sqlite://")
        meta = MetaData()
        Table("users", meta, Column("id", Integer, primary_key=True))
        Table("pre_test_intro_sessions", meta, Column("id", Integer, primary_key=True))
        Table("pre_test_active_listening_sessions", meta, Column("id", Integer, primary_key=True))
        meta.create_all(engine)
        with engine.begin() as connection:
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            self.assertIn("adaptive_practice_sessions", inspect(connection).get_table_names())
            self.assertIn("scoring_authority", {item["name"] for item in inspect(connection).get_columns("pre_test_intro_sessions")})
            module.downgrade()
            self.assertNotIn("adaptive_practice_sessions", inspect(connection).get_table_names())
            self.assertNotIn("scoring_authority", {item["name"] for item in inspect(connection).get_columns("pre_test_intro_sessions")})
            self.assertNotIn("scoring_authority", {item["name"] for item in inspect(connection).get_columns("pre_test_active_listening_sessions")})
        engine.dispose()

    def test_provider_generation_is_one_call_and_fallback_is_labelled(self):
        class Provider:
            def __init__(self, response):
                self.response = response
                self.calls = []

            async def stream_chat(self, messages, workload=None):
                self.calls.append((messages, workload))
                yield self.response

        provider = Provider(json.dumps(PROMPT))
        generated, authority = asyncio.run(generate_adaptive_prompt("clarity", "intermediate", "CCIT", 2.5, ["planning"], [], provider))
        self.assertEqual((generated, authority), (PROMPT, "ai_generated"))
        self.assertEqual(len(provider.calls), 1)
        sent = json.dumps(provider.calls[0][0])
        self.assertNotIn("first@example.test", sent)
        self.assertNotIn("First User", sent)
        invalid = Provider("not-json")
        fallback, fallback_authority = asyncio.run(generate_adaptive_prompt("clarity", "intermediate", "CCIT", 2.5, [], [], invalid))
        self.assertEqual(fallback_authority, "deterministic_fallback")
        self.assertIn("software project", fallback["scenario"])
        self.assertEqual(len(invalid.calls), 1)

    def test_adaptive_scorer_uses_saved_task_and_six_validated_criteria(self):
        class Provider:
            def __init__(self):
                self.calls = []

            async def stream_chat(self, messages, workload=None):
                self.calls.append((messages, workload))
                yield json.dumps({**SCORES, "task_alignment": 4, "total_score": 22.0,
                    "feedback_summary": "You gave a relevant main point and stayed on the assigned task. Your explanation could be clearer where it moves between ideas. State the main point first, then give one specific supporting detail and a concise next step."})

        provider = Provider()
        result = asyncio.run(score_adaptive_practice("clarity", PROMPT["scenario"], PROMPT["prompt"],
            "I will describe the plan clearly and give one supporting detail for the teammate.", provider))
        self.assertEqual(len(provider.calls), 1)
        self.assertIn(PROMPT["prompt"], json.dumps(provider.calls[0][0]))
        self.assertEqual(result["criteria"]["clarity"], 2.0)
        self.assertEqual(result["scoring_authority"], "semantic_ai_with_objective_caps")


if __name__ == "__main__":
    unittest.main()

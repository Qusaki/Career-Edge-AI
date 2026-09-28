import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from core.negotiation import NegotiationSnapshot, advance_negotiation, is_clear_acceptance, load_negotiation_snapshot
from database import Base, get_db
from models.drills import DrillSession
from models.user import User
from routers import drills


class NegotiationDecisionTests(unittest.TestCase):
    def test_clear_acceptance_phrases_use_the_current_offer(self):
        for text in (
            "I accept.", "I accept the 37k offer.", "37k works for me.",
            "Deal.", "Okay, I agree.", "That works for me.", "I'll take it.",
            "I have 5 years of experience, but yes, I accept.",
        ):
            with self.subTest(text=text):
                self.assertTrue(is_clear_acceptance(text, 37000))
                agreed = advance_negotiation(NegotiationSnapshot(current_offer=37000), text)
                self.assertEqual(agreed.status, "agreed")
                self.assertEqual(agreed.current_offer, 37000)
                self.assertEqual(agreed.accepted_salary, 37000)

    def test_questions_rejections_and_counteroffers_do_not_accept(self):
        for text in (
            "What benefits are included?", "Can you offer more?", "37k is too low.",
            "I need to think about it.", "What about 40k?", "I want better benefits.",
            "I think I'm worth more.", "Can we negotiate?", "I don't accept.",
            "I accept the 40k offer.", "Sounds good, but can you offer more?",
        ):
            with self.subTest(text=text):
                self.assertFalse(is_clear_acceptance(text, 37000))

    def test_accepted_state_never_changes_salary_and_closes_without_an_offer(self):
        agreed = advance_negotiation(NegotiationSnapshot(current_offer=37000), "I accept.")
        for closing in ("Thank you.", "Goodbye.", "Can you offer 42k instead?"):
            with self.subTest(closing=closing):
                closed = advance_negotiation(agreed, closing)
                self.assertEqual(closed.status, "closed")
                self.assertEqual(closed.current_offer, 37000)
                self.assertEqual(closed.accepted_salary, 37000)
                self.assertNotIn("₱", closed.last_response)
                self.assertNotIn("offer", closed.last_response.lower())

    def test_initial_benefits_and_bargaining_states_remain_negotiating(self):
        initial = NegotiationSnapshot()
        self.assertEqual((initial.status, initial.current_offer), ("negotiating", 35000))
        benefits = advance_negotiation(initial, "What benefits are included?")
        self.assertEqual((benefits.status, benefits.current_offer), ("negotiating", 35000))
        higher = advance_negotiation(benefits, "I need a higher salary.")
        self.assertEqual((higher.status, higher.current_offer), ("negotiating", 37000))


class NegotiationEndpointTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.Session() as db:
            db.add_all([
                User(id=1, email="negotiation-owner@example.com", hashed_password="x", firstname="Owner", lastname="One", department="CCIT"),
                User(id=2, email="negotiation-other@example.com", hashed_password="x", firstname="Other", lastname="Two", department="CCIT"),
            ])
            db.add(DrillSession(user_id=1, drill_level="hard", drill_type="negotiation", status="active",
                                canonical_prompt={"scenario": "Starting offer ₱35,000"}))
            db.commit()
            self.session_id = db.query(DrillSession).first().id
        self.app = FastAPI()
        self.app.include_router(drills.router, prefix="/drills")

        def override_db():
            with self.Session() as db:
                yield db

        self.app.dependency_overrides[get_db] = override_db
        self.use_user(1)
        self.client = TestClient(self.app)

    def use_user(self, user_id):
        def override_user():
            with self.Session() as db:
                yield db.get(User, user_id)

        self.app.dependency_overrides[get_current_user] = override_user

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def turn(self, message, number=0, offer=35000, session_id=None):
        return self.client.post("/drills/hard/negotiation/turn", json={
            "session_id": session_id or self.session_id,
            "user_message": message,
            "turn_number": number,
            "current_offer": offer,
        })

    def test_acceptance_is_persisted_and_resumed_without_reopening_bargaining(self):
        benefits = self.turn("What benefits are included?")
        self.assertEqual((benefits.status_code, benefits.json()["new_offer"]), (200, 35000))
        higher = self.turn("I think my value is higher.", 1, 35000)
        self.assertEqual(higher.json()["new_offer"], 37000)
        accepted = self.turn("I accept the 37k offer.", 2, 37000)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["negotiation_state"], "agreed")
        self.assertEqual(accepted.json()["accepted_salary"], 37000)
        self.assertEqual(accepted.json()["new_offer"], 37000)
        self.assertTrue(accepted.json()["is_game_over"])

        replay = self.turn("I accept the 37k offer.", 2, 37000)
        self.assertEqual(replay.json(), accepted.json())
        resumed = self.client.post("/drills/start", json={"drill_level": "hard", "drill_type": "negotiation"})
        self.assertEqual(resumed.status_code, 200)
        saved = load_negotiation_snapshot(resumed.json()["evaluation_data"])
        self.assertEqual((saved.status, saved.current_offer, saved.accepted_salary, saved.turn_number),
                         ("agreed", 37000, 37000, 3))
        self.assertEqual(len(saved.messages), 6)

        closing = self.turn("Thank you.", 3, 37000)
        self.assertEqual(closing.json()["negotiation_state"], "closed")
        self.assertEqual(closing.json()["new_offer"], 37000)
        self.assertNotIn("₱", closing.json()["response"])
        repeated = self.turn("Goodbye.", 4, 37000)
        self.assertEqual(repeated.json()["new_offer"], 37000)
        self.assertEqual(repeated.json()["negotiation_state"], "closed")
        with self.Session() as db:
            stored = db.get(DrillSession, self.session_id)
            self.assertEqual(stored.status, "active")
            self.assertIsNone(stored.score)
            self.assertEqual(load_negotiation_snapshot(stored.evaluation_data).accepted_salary, 37000)

    def test_goodbye_directly_after_acceptance_only_closes(self):
        self.turn("Can you increase the salary?")
        self.turn("Deal.", 1, 37000)
        response = self.turn("Goodbye.", 2, 37000)
        self.assertEqual(response.json()["negotiation_state"], "closed")
        self.assertEqual(response.json()["new_offer"], 37000)
        self.assertNotIn("₱", response.json()["response"])

    def test_owner_session_and_other_drill_type_are_required(self):
        self.use_user(2)
        self.assertEqual(self.turn("I accept.").status_code, 404)
        self.use_user(1)
        with self.Session() as db:
            other = DrillSession(user_id=1, drill_level="easy", drill_type="jam", status="active")
            db.add(other)
            db.commit()
            self.assertEqual(self.turn("I accept.", session_id=other.id).status_code, 404)
            self.assertIsNone(db.get(DrillSession, other.id).evaluation_data)

    def test_client_offer_cannot_override_the_persisted_offer(self):
        self.turn("Can you offer more?")
        mismatch = self.turn("I accept.", 1, 42000)
        self.assertEqual(mismatch.status_code, 409)
        with self.Session() as db:
            snapshot = load_negotiation_snapshot(db.get(DrillSession, self.session_id).evaluation_data)
            self.assertEqual(snapshot.current_offer, 37000)
            self.assertEqual(snapshot.status, "negotiating")


if __name__ == "__main__":
    unittest.main()

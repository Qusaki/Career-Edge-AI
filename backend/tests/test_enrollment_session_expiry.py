import asyncio
import datetime
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, WebSocketDisconnect
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from database import Base, get_db
from models.upcoming_student_interview import UpcomingStudentInterviewMessage, UpcomingStudentInterviewSession
from models.user import User
from routers import upcoming_student_interview


class DisconnectingWebSocket:
    def __init__(self):
        self.accept = AsyncMock()
        self.close = AsyncMock()

    async def receive(self):
        raise WebSocketDisconnect


class EnrollmentSessionExpiryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        with self.Session() as db:
            db.add_all([
                User(id=1, email="enrollment-owner@example.com", hashed_password="x", firstname="Owner", lastname="One", department="CCIT"),
                User(id=2, email="enrollment-other@example.com", hashed_password="x", firstname="Other", lastname="Two", department="CTE"),
            ])
            db.commit()

        self.app = FastAPI()
        self.app.include_router(upcoming_student_interview.router, prefix="/upcoming-student-interview")

        def override_db():
            with self.Session() as db:
                yield db

        self.app.dependency_overrides[get_db] = override_db
        self.use_user(1)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def use_user(self, user_id):
        def override_user():
            with self.Session() as db:
                yield db.get(User, user_id)

        self.app.dependency_overrides[get_current_user] = override_user

    def add_session(self, user_id=1, age=datetime.timedelta(minutes=30), history=()):
        with self.Session() as db:
            session = UpcomingStudentInterviewSession(
                user_id=user_id,
                status="active",
                start_time=datetime.datetime.utcnow() - age,
            )
            db.add(session)
            db.flush()
            session_id = session.id
            for role, content in history:
                db.add(UpcomingStudentInterviewMessage(session_id=session_id, role=role, content=content))
            db.commit()
            return session_id

    def start(self):
        return self.client.post("/upcoming-student-interview/start")

    def test_shared_rule_preserves_exact_one_hour_boundary(self):
        now = datetime.datetime(2026, 1, 1, 12, 0, 0)
        limit = datetime.timedelta(seconds=upcoming_student_interview.INTERVIEW_TIME_LIMIT_SECONDS)
        self.assertFalse(upcoming_student_interview.is_interview_expired(now - limit + datetime.timedelta(microseconds=1), now))
        self.assertFalse(upcoming_student_interview.is_interview_expired(now - limit, now))
        self.assertTrue(upcoming_student_interview.is_interview_expired(now - limit - datetime.timedelta(microseconds=1), now))

    def test_recent_active_session_resumes_without_changing_history(self):
        session_id = self.add_session(history=(("ai", "Saved question"),))
        response = self.start()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], session_id)
        with self.Session() as db:
            self.assertEqual(db.get(UpcomingStudentInterviewSession, session_id).status, "active")
            self.assertEqual(db.query(UpcomingStudentInterviewSession).count(), 1)
            self.assertEqual(db.query(UpcomingStudentInterviewMessage).one().content, "Saved question")

    def test_expired_session_is_preserved_and_replaced_with_fresh_websocket_eligible_session(self):
        old_id = self.add_session(
            age=datetime.timedelta(hours=2),
            history=(("ai", "Old question"), ("user", "Old answer")),
        )
        response = self.start()
        self.assertEqual(response.status_code, 200)
        new_id = response.json()["id"]
        self.assertNotEqual(new_id, old_id)
        self.assertEqual(response.json()["status"], "active")

        with self.Session() as db:
            old = db.get(UpcomingStudentInterviewSession, old_id)
            fresh = db.get(UpcomingStudentInterviewSession, new_id)
            self.assertEqual(old.status, "expired")
            self.assertEqual(fresh.status, "active")
            self.assertEqual(db.query(UpcomingStudentInterviewSession).count(), 2)
            old_history = db.query(UpcomingStudentInterviewMessage).filter_by(session_id=old_id).order_by(UpcomingStudentInterviewMessage.id).all()
            self.assertEqual([(item.role, item.content) for item in old_history], [("ai", "Old question"), ("user", "Old answer")])
            self.assertEqual(db.query(UpcomingStudentInterviewMessage).filter_by(session_id=new_id).count(), 0)
            self.assertFalse(upcoming_student_interview.is_interview_expired(fresh.start_time, datetime.datetime.utcnow()))

            websocket = DisconnectingWebSocket()
            with patch.object(upcoming_student_interview, "get_ai_provider", side_effect=AssertionError("No paid provider call")):
                asyncio.run(upcoming_student_interview.interview_chat_ws(
                    websocket=websocket, session_id=new_id, db=db, current_user=db.get(User, 1),
                ))
            websocket.accept.assert_awaited_once()
            websocket.close.assert_not_awaited()

    def test_repeated_start_reuses_single_replacement_session(self):
        old_id = self.add_session(age=datetime.timedelta(hours=2))
        first = self.start()
        second = self.start()
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertNotEqual(first.json()["id"], old_id)
        self.assertEqual(second.json()["id"], first.json()["id"])
        with self.Session() as db:
            self.assertEqual(db.query(UpcomingStudentInterviewSession).filter_by(user_id=1, status="active").count(), 1)

    def test_other_users_active_session_is_never_reused(self):
        other_id = self.add_session(user_id=2)
        response = self.start()
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()["id"], other_id)
        self.assertEqual(response.json()["user_id"], 1)
        with self.Session() as db:
            self.assertEqual(db.get(UpcomingStudentInterviewSession, other_id).status, "active")
            websocket = DisconnectingWebSocket()
            asyncio.run(upcoming_student_interview.interview_chat_ws(
                websocket=websocket, session_id=other_id, db=db, current_user=db.get(User, 1),
            ))
            websocket.accept.assert_not_awaited()
            websocket.close.assert_awaited_once()

    def test_websocket_still_expires_an_old_active_session(self):
        old_id = self.add_session(age=datetime.timedelta(hours=2))
        with self.Session() as db:
            websocket = DisconnectingWebSocket()
            asyncio.run(upcoming_student_interview.interview_chat_ws(
                websocket=websocket, session_id=old_id, db=db, current_user=db.get(User, 1),
            ))
            websocket.accept.assert_not_awaited()
            self.assertEqual(websocket.close.await_args.kwargs["reason"], "Interview time limit (1 hour) exceeded.")
            self.assertEqual(db.get(UpcomingStudentInterviewSession, old_id).status, "expired")


if __name__ == "__main__":
    unittest.main()

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from core.deps import get_current_user, get_current_user_ws
from core.drill_progression import DRILL_LEVEL_BY_TYPE
from database import Base, get_db
from models.drills import DrillSession
from models.post_test_interview import PostTestInterviewSession
from models.post_test_interview import PostTestInterviewMessage
from models.user import User
from routers import drills, post_test_interview


class PostTestProgressionGateTests(unittest.TestCase):
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
                User(id=1, email="gate-one@example.com", hashed_password="x", firstname="Gate", lastname="One", department="CCIT"),
                User(id=2, email="gate-two@example.com", hashed_password="x", firstname="Gate", lastname="Two", department="CCIT"),
            ])
            db.commit()

        self.current_user_id = 1
        self.app = FastAPI()
        self.app.include_router(drills.router, prefix="/drills")
        self.app.include_router(post_test_interview.router, prefix="/post-test-interview")

        def override_db():
            with self.SessionLocal() as db:
                yield db

        def override_user():
            with self.SessionLocal() as db:
                return db.get(User, self.current_user_id)

        self.app.dependency_overrides[get_db] = override_db
        self.app.dependency_overrides[get_current_user] = override_user
        self.app.dependency_overrides[get_current_user_ws] = override_user
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.dispose()

    def add_drills(self, *types: str, user_id: int = 1, status: str = "completed") -> None:
        with self.SessionLocal() as db:
            for drill_type in types:
                db.add(DrillSession(
                    user_id=user_id,
                    drill_level=DRILL_LEVEL_BY_TYPE.get(drill_type, "hard"),
                    drill_type=drill_type,
                    status=status,
                ))
            db.commit()

    def progress(self) -> dict:
        response = self.client.get("/drills/progress")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def start(self):
        return self.client.post("/post-test-interview/start")

    def test_zero_one_and_eleven_unique_completed_drills_remain_locked(self) -> None:
        canonical = tuple(DRILL_LEVEL_BY_TYPE)
        for count in (0, 1, 11):
            with self.subTest(completed=count):
                with self.SessionLocal() as db:
                    db.query(DrillSession).delete()
                    db.commit()
                self.add_drills(*canonical[:count])
                progress = self.progress()
                self.assertFalse(progress["post_test_unlocked"])
                self.assertEqual(progress["completed_drill_count"], count)
                self.assertEqual(progress["required_drill_count"], 12)
                response = self.start()
                self.assertEqual(response.status_code, 403, response.text)
                self.assertIn("Complete all Drill activities", response.json()["detail"])

    def test_final_unique_drill_unlocks_and_start_succeeds(self) -> None:
        canonical = tuple(DRILL_LEVEL_BY_TYPE)
        self.add_drills(*canonical[:-1])
        self.assertFalse(self.progress()["post_test_unlocked"])
        self.add_drills(canonical[-1])

        progress = self.progress()
        self.assertTrue(progress["post_test_unlocked"])
        self.assertEqual(progress["completed_drill_count"], 12)
        response = self.start()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "active")

    def test_replays_and_unknown_types_do_not_substitute_for_missing_drills(self) -> None:
        canonical = tuple(DRILL_LEVEL_BY_TYPE)
        self.add_drills(*canonical[:-1], "jam", "jam", "unknown_historical_type")
        progress = self.progress()
        self.assertFalse(progress["post_test_unlocked"])
        self.assertEqual(progress["completed_drill_count"], 11)
        self.assertEqual(self.start().status_code, 403)

    def test_pending_and_incomplete_final_drill_do_not_unlock(self) -> None:
        canonical = tuple(DRILL_LEVEL_BY_TYPE)
        self.add_drills(*canonical[:-1])
        self.add_drills(canonical[-1], status="active")
        self.add_drills(canonical[-1], status="pending_sync")
        self.assertFalse(self.progress()["post_test_unlocked"])
        self.assertEqual(self.start().status_code, 403)
        self.add_drills(canonical[-1], status="completed")
        self.assertTrue(self.progress()["post_test_unlocked"])

    def test_progress_and_start_remain_isolated_per_authenticated_user(self) -> None:
        self.add_drills(*DRILL_LEVEL_BY_TYPE)
        self.assertTrue(self.progress()["post_test_unlocked"])
        self.assertEqual(self.start().status_code, 200)

        self.current_user_id = 2
        self.assertFalse(self.progress()["post_test_unlocked"])
        self.assertEqual(self.start().status_code, 403)

    def test_legacy_sessions_are_preserved_and_history_remains_readable(self) -> None:
        with self.SessionLocal() as db:
            completed = PostTestInterviewSession(user_id=1, status="completed")
            active = PostTestInterviewSession(user_id=1, status="active")
            db.add_all([completed, active])
            db.commit()
            completed_id, active_id = completed.id, active.id

        self.assertEqual(self.start().status_code, 403)
        history = self.client.get("/post-test-interview/")
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual({item["id"] for item in history.json()}, {completed_id, active_id})
        self.assertEqual(self.client.get(f"/post-test-interview/{completed_id}").status_code, 200)
        self.assertEqual(self.client.get(f"/post-test-interview/{active_id}").status_code, 403)
        with self.SessionLocal() as db:
            self.assertEqual(db.get(PostTestInterviewSession, active_id).status, "active")

    def test_legacy_active_session_cannot_bypass_gate_through_websocket(self) -> None:
        with self.SessionLocal() as db:
            session = PostTestInterviewSession(user_id=1, status="active")
            db.add(session)
            db.commit()
            session_id = session.id

        with self.assertRaises(WebSocketDisconnect) as context:
            with self.client.websocket_connect(f"/post-test-interview/{session_id}/chat") as socket:
                socket.receive_json()
        self.assertEqual(context.exception.code, 1008)
        with self.SessionLocal() as db:
            self.assertEqual(db.get(PostTestInterviewSession, session_id).status, "active")

    def test_legacy_active_session_cannot_complete_before_drills(self) -> None:
        with self.SessionLocal() as db:
            session = PostTestInterviewSession(user_id=1, status="active")
            db.add(session)
            db.commit()
            session_id = session.id
            db.add_all([
                PostTestInterviewMessage(session_id=session_id, role="user", content=f"Answer {index}")
                for index in range(5)
            ])
            db.commit()

        response = self.client.post(
            f"/post-test-interview/{session_id}/complete",
            json={"conversation": [], "evaluation": {"score_vocabulary": 4}},
        )
        self.assertEqual(response.status_code, 403, response.text)
        with self.SessionLocal() as db:
            self.assertEqual(db.get(PostTestInterviewSession, session_id).status, "active")


if __name__ == "__main__":
    unittest.main()

import datetime
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.deps import get_current_user
from core.drill_progression import DRILL_TYPES_BY_LEVEL
from database import Base, get_db
from models.drills import DrillSession
from models.user import User
from routers import drills


class DrillProgressionTests(unittest.TestCase):
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
                User(
                    id=1,
                    email="progress-one@example.com",
                    hashed_password="x",
                    firstname="Progress",
                    lastname="One",
                    department="CCIT",
                ),
                User(
                    id=2,
                    email="progress-two@example.com",
                    hashed_password="x",
                    firstname="Progress",
                    lastname="Two",
                    department="CCIT",
                ),
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

    def add_completed(self, *drill_types: str, user_id: int = 1) -> None:
        with self.Session() as db:
            for drill_type in drill_types:
                db.add(DrillSession(
                    user_id=user_id,
                    drill_level=drills.DRILL_LEVEL_BY_TYPE[drill_type],
                    drill_type=drill_type,
                    status="completed",
                    start_time=datetime.datetime.utcnow(),
                    end_time=datetime.datetime.utcnow(),
                ))
            db.commit()

    def progress(self) -> dict:
        response = self.client.get("/drills/progress")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def start(self, level: str, drill_type: str):
        return self.client.post(
            "/drills/start",
            json={"drill_level": level, "drill_type": drill_type},
        )

    def test_new_user_has_only_easy_unlocked(self) -> None:
        progress = self.progress()
        self.assertTrue(progress["easy"]["unlocked"])
        self.assertFalse(progress["medium"]["unlocked"])
        self.assertFalse(progress["hard"]["unlocked"])
        self.assertEqual(progress["easy"]["completed"], 0)
        self.assertEqual(progress["easy"]["total"], 2)

    def test_jam_alone_does_not_unlock_medium(self) -> None:
        self.add_completed("jam")
        progress = self.progress()
        self.assertEqual(progress["easy"]["completed_types"], ["jam"])
        self.assertFalse(progress["medium"]["unlocked"])

    def test_fast_word_alone_does_not_unlock_medium(self) -> None:
        self.add_completed("fast_word")
        progress = self.progress()
        self.assertEqual(progress["easy"]["completed_types"], ["fast_word"])
        self.assertFalse(progress["medium"]["unlocked"])

    def test_all_unique_easy_types_unlock_medium(self) -> None:
        self.add_completed(*DRILL_TYPES_BY_LEVEL["easy"])
        progress = self.progress()
        self.assertEqual(progress["easy"]["completed"], 2)
        self.assertTrue(progress["medium"]["unlocked"])
        self.assertFalse(progress["hard"]["unlocked"])

    def test_duplicate_jam_does_not_substitute_for_fast_word(self) -> None:
        self.add_completed("jam", "jam", "jam")
        progress = self.progress()
        self.assertEqual(progress["easy"]["completed"], 1)
        self.assertEqual(progress["easy"]["completed_types"], ["jam"])
        self.assertFalse(progress["medium"]["unlocked"])

    def test_medium_direct_start_is_rejected_before_easy_completion(self) -> None:
        response = self.start("medium", "emotion")
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["detail"], "Complete all Easy drills before unlocking Medium.")

    def test_hard_direct_start_is_rejected_before_medium_completion(self) -> None:
        response = self.start("hard", "taboo")
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["detail"], "Complete all Medium drills before unlocking Hard.")

    def test_all_medium_types_unlock_hard(self) -> None:
        self.add_completed(*DRILL_TYPES_BY_LEVEL["easy"], *DRILL_TYPES_BY_LEVEL["medium"])
        progress = self.progress()
        self.assertEqual(progress["medium"]["completed"], 5)
        self.assertTrue(progress["hard"]["unlocked"])

    def test_completed_drill_type_can_be_replayed(self) -> None:
        self.add_completed("jam")
        response = self.start("easy", "jam")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "active")

    def test_progress_is_isolated_by_authenticated_user(self) -> None:
        self.add_completed(*DRILL_TYPES_BY_LEVEL["easy"], user_id=1)
        self.current_user_id = 2
        progress = self.progress()
        self.assertEqual(progress["easy"]["completed"], 0)
        self.assertFalse(progress["medium"]["unlocked"])

    def test_existing_active_locked_level_session_can_resume(self) -> None:
        with self.Session() as db:
            active = DrillSession(
                user_id=1,
                drill_level="medium",
                drill_type="emotion",
                status="active",
                canonical_prompt={"sentence": "The food is here.", "emotion": "Excited"},
                start_time=datetime.datetime.utcnow(),
            )
            db.add(active)
            db.commit()
            db.refresh(active)
            active_id = active.id

        response = self.start("medium", "emotion")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], active_id)


if __name__ == "__main__":
    unittest.main()

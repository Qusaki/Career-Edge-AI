import datetime
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from routers import drills, post_test_interview, pre_test_active_listening


def make_db_with_active_session(active_session):
    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.first.return_value = active_session
    return db


class ExerciseSessionStartTests(unittest.TestCase):
    def test_active_listening_replaces_session_older_than_one_hour(self):
        stale_session = SimpleNamespace(
            start_time=datetime.datetime.utcnow() - datetime.timedelta(hours=2),
            status="active",
            end_time=None,
        )
        db = make_db_with_active_session(stale_session)

        new_session = pre_test_active_listening.start_session(
            db=db,
            current_user=SimpleNamespace(id=7),
        )

        self.assertEqual(stale_session.status, "expired")
        self.assertIsNotNone(stale_session.end_time)
        self.assertIsNot(new_session, stale_session)
        db.add.assert_called_once_with(new_session)
        self.assertEqual(db.commit.call_count, 2)

    def test_active_listening_resumes_session_within_one_hour(self):
        active_session = SimpleNamespace(
            start_time=datetime.datetime.utcnow() - datetime.timedelta(minutes=30),
            status="active",
            end_time=None,
        )
        db = make_db_with_active_session(active_session)

        result = pre_test_active_listening.start_session(
            db=db,
            current_user=SimpleNamespace(id=7),
        )

        self.assertIs(result, active_session)
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_post_test_replaces_session_older_than_one_hour(self):
        stale_session = SimpleNamespace(
            start_time=datetime.datetime.utcnow() - datetime.timedelta(hours=2),
            status="active",
            end_time=None,
        )
        db = make_db_with_active_session(stale_session)

        new_session = post_test_interview.start_session(
            db=db,
            current_user=SimpleNamespace(id=7, department="CCIT"),
        )

        self.assertEqual(stale_session.status, "expired")
        self.assertIsNotNone(stale_session.end_time)
        self.assertIsNot(new_session, stale_session)
        db.add.assert_called_once_with(new_session)
        self.assertEqual(db.commit.call_count, 2)

    def test_drill_replaces_session_older_than_one_hour(self):
        stale_session = SimpleNamespace(
            start_time=datetime.datetime.utcnow() - datetime.timedelta(hours=2),
            status="active",
            end_time=None,
        )
        db = make_db_with_active_session(stale_session)
        request = SimpleNamespace(drill_level="easy", drill_type="jam")

        new_session = drills.start_drill_session(
            request=request,
            db=db,
            current_user=SimpleNamespace(id=7),
        )

        self.assertEqual(stale_session.status, "expired")
        self.assertIsNotNone(stale_session.end_time)
        self.assertIsNot(new_session, stale_session)
        db.add.assert_called_once_with(new_session)
        self.assertEqual(db.commit.call_count, 2)


if __name__ == "__main__":
    unittest.main()

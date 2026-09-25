import asyncio
import datetime
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, UploadFile, WebSocketDisconnect
from fastapi.testclient import TestClient

from core import aws
from core.deps import get_current_user
from database import get_db
from models.thesis_interview import ThesisInterviewMessage, ThesisInterviewSession
from routers import thesis_interview


class FakeQuery:
    def __init__(self, first_value=None, all_values=None):
        self.first_value = first_value
        self.all_values = all_values or []

    def filter(self, *args):
        return self

    def order_by(self, *args):
        return self

    def first(self):
        return self.first_value

    def all(self):
        return self.all_values


class FakeDatabase:
    def __init__(self, session):
        self.session = session
        self.messages = []
        self.commit_count = 0
        self.rollback_count = 0
        self.refresh_count = 0

    def query(self, model):
        if model is ThesisInterviewSession:
            return FakeQuery(first_value=self.session)
        if model is ThesisInterviewMessage:
            return FakeQuery(all_values=self.messages)
        raise AssertionError(f"Unexpected model {model}")

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def refresh(self, session):
        self.refresh_count += 1

    def add(self, message):
        self.messages.append(message)


def active_session(owner=7, status="active", minutes_ago=0):
    return SimpleNamespace(
        id=12,
        user_id=owner,
        status=status,
        start_time=datetime.datetime.utcnow() - datetime.timedelta(minutes=minutes_ago),
        abstract_s3_key=None,
    )


def upload_file(filename="abstract.txt", content=b"A readable research abstract."):
    return UploadFile(file=io.BytesIO(content), filename=filename)


def send_upload(db, file=None, abstract_text="A readable research abstract.", owner=7):
    return asyncio.run(thesis_interview.upload_abstract(
        session_id=12,
        file=file or upload_file(),
        abstract_text=abstract_text,
        db=db,
        current_user=SimpleNamespace(id=owner, department="CCIT"),
    ))


class FakeWebSocket:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.accept = AsyncMock()
        self.send_json = AsyncMock()
        self.close = AsyncMock()

    async def receive(self):
        try:
            return next(self.messages)
        except StopIteration:
            raise WebSocketDisconnect


class StaticProvider:
    def __init__(self):
        self.messages = None

    async def stream_chat(self, messages, workload=None):
        self.messages = messages
        yield "A thesis question."


class ThesisAbstractUploadTests(unittest.TestCase):
    def test_multipart_http_contract_accepts_owner_and_rejects_other_user(self):
        db = FakeDatabase(active_session())
        app = FastAPI()
        app.include_router(thesis_interview.router, prefix="/thesis-interview")
        app.dependency_overrides[get_db] = lambda: db
        user = SimpleNamespace(id=7, department="CCIT")
        app.dependency_overrides[get_current_user] = lambda: user
        with TestClient(app) as client, patch.object(thesis_interview, "store_thesis_abstract_text", return_value="abstracts/session_12_http.txt"):
            response = client.post(
                "/thesis-interview/12/upload-abstract",
                files={"file": ("abstract.txt", b"A readable research abstract.", "text/plain")},
                data={"abstract_text": "A readable research abstract."},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"updated": True})
            user.id = 8
            denied = client.post(
                "/thesis-interview/12/upload-abstract",
                files={"file": ("abstract.txt", b"A readable research abstract.", "text/plain")},
                data={"abstract_text": "A readable research abstract."},
            )
            self.assertEqual(denied.status_code, 404)

    def test_route_is_registered_and_owner_upload_persists_canonical_key(self):
        self.assertTrue(any(
            route.path == "/{session_id}/upload-abstract" and "POST" in route.methods
            for route in thesis_interview.router.routes
        ))
        db = FakeDatabase(active_session())
        with patch.object(thesis_interview, "store_thesis_abstract_text", return_value="abstracts/session_12_new.txt") as store:
            self.assertEqual(send_upload(db), {"updated": True})
        store.assert_called_once_with(12, "A readable research abstract.")
        self.assertEqual(db.session.abstract_s3_key, "abstracts/session_12_new.txt")
        self.assertEqual(db.commit_count, 1)

    def test_other_user_or_missing_session_cannot_upload(self):
        for session, owner in [(active_session(owner=8), 7), (None, 7)]:
            db = FakeDatabase(session)
            with patch.object(thesis_interview, "store_thesis_abstract_text") as store:
                with self.assertRaises(HTTPException) as raised:
                    send_upload(db, owner=owner)
            self.assertEqual(raised.exception.status_code, 404)
            store.assert_not_called()

    def test_nonpositive_and_unsafe_session_ids_cannot_upload(self):
        for session_id in [0, -1, 9007199254740992]:
            with self.subTest(session_id=session_id):
                db = FakeDatabase(active_session())
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(thesis_interview.upload_abstract(
                        session_id=session_id,
                        file=upload_file(),
                        abstract_text="A readable research abstract.",
                        db=db,
                        current_user=SimpleNamespace(id=7, department="CCIT"),
                    ))
                self.assertEqual(raised.exception.status_code, 404)

    def test_completed_expired_and_timed_out_sessions_reject_updates(self):
        for session in [active_session(status="completed"), active_session(status="expired"), active_session(minutes_ago=61)]:
            db = FakeDatabase(session)
            with patch.object(thesis_interview, "store_thesis_abstract_text") as store:
                with self.assertRaises(HTTPException) as raised:
                    send_upload(db)
            self.assertEqual(raised.exception.status_code, 409)
            store.assert_not_called()
        self.assertEqual(db.session.status, "expired")

    def test_invalid_unreadable_and_oversized_files_are_rejected(self):
        cases = [
            ("abstract.docx", b"A readable research abstract.", "A readable research abstract.", 400),
            ("abstract.txt", b"", "A readable research abstract.", 400),
            ("abstract.txt", b"\xff\xfe", "A readable research abstract.", 400),
            ("abstract.pdf", b"not a PDF", "A readable research abstract.", 400),
            ("abstract.txt", b"A readable research abstract.", "!!!", 400),
            ("abstract.txt", b"A readable research abstract.", "Different text", 400),
            ("abstract.txt", b"A readable research abstract.", "x" * 5001, 400),
            ("abstract.txt", b"x" * (thesis_interview.THESIS_ABSTRACT_MAX_BYTES + 1), "x", 413),
        ]
        for filename, content, abstract_text, status in cases:
            with self.subTest(filename=filename, status=status):
                db = FakeDatabase(active_session())
                with patch.object(thesis_interview, "store_thesis_abstract_text") as store:
                    with self.assertRaises(HTTPException) as raised:
                        send_upload(db, upload_file(filename, content), abstract_text)
                self.assertEqual(raised.exception.status_code, status)
                store.assert_not_called()

    def test_pdf_with_extracted_text_is_accepted_without_new_pdf_dependency(self):
        db = FakeDatabase(active_session())
        with patch.object(thesis_interview, "store_thesis_abstract_text", return_value="abstracts/session_12_pdf.txt"):
            result = send_upload(db, upload_file("abstract.pdf", b"%PDF-1.7\n"), "Readable extracted PDF abstract")
        self.assertEqual(result, {"updated": True})

    def test_storage_failure_does_not_change_session_key(self):
        db = FakeDatabase(active_session())
        db.session.abstract_s3_key = "abstracts/previous.txt"
        with patch.object(thesis_interview, "store_thesis_abstract_text", side_effect=RuntimeError("private storage detail")):
            with self.assertRaises(HTTPException) as raised:
                send_upload(db)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn("private storage detail", raised.exception.detail)
        self.assertEqual(db.rollback_count, 1)

    def test_database_failure_rolls_back_and_removes_only_new_object(self):
        db = FakeDatabase(active_session())
        db.session.abstract_s3_key = "abstracts/previous.txt"
        db.commit = lambda: (_ for _ in ()).throw(RuntimeError("database unavailable"))
        with patch.object(thesis_interview, "store_thesis_abstract_text", return_value="abstracts/session_12_new.txt"), patch.object(thesis_interview, "delete_abstract_from_s3") as delete:
            with self.assertRaises(HTTPException) as raised:
                send_upload(db)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(db.rollback_count, 1)
        delete.assert_called_once_with("abstracts/session_12_new.txt")

    def test_same_abstract_retry_uses_same_key_without_duplicate_context(self):
        with patch.object(aws, "AWS_REGION", "test-region"), patch.object(aws, "AWS_S3_ABSTRACTS_BUCKET_NAME", "test-bucket"), patch.object(aws.s3_client, "put_object") as put:
            first = aws.store_thesis_abstract_text(12, "A readable research abstract.")
            second = aws.store_thesis_abstract_text(12, "A readable research abstract.")
        self.assertEqual(first, second)
        self.assertEqual(put.call_count, 2)
        self.assertEqual(put.call_args.kwargs["Body"], b"A readable research abstract.")

    def test_subsequent_ai_turn_uses_saved_context_instead_of_stale_browser_text(self):
        db = FakeDatabase(active_session())
        db.session.abstract_s3_key = "abstracts/session_12_new.txt"
        websocket = FakeWebSocket([{"text": json.dumps({"type": "start", "abstract_text": "Old browser text"})}])
        provider = StaticProvider()
        with patch.object(thesis_interview, "get_abstract_text_from_s3", return_value="Updated saved abstract"), patch.object(thesis_interview, "get_ai_provider", return_value=provider):
            asyncio.run(thesis_interview.interview_chat_ws(
                websocket=websocket,
                session_id=12,
                db=db,
                current_user=SimpleNamespace(id=7, department="CCIT"),
            ))
        self.assertEqual(db.refresh_count, 1)
        prompt = provider.messages[0]["content"]
        self.assertIn("Updated saved abstract", prompt)
        self.assertNotIn("Old browser text", prompt)


if __name__ == "__main__":
    unittest.main()

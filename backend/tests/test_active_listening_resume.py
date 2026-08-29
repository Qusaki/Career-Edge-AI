import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import WebSocketDisconnect
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base
from models.pre_test_active_listening import (
    PreTestActiveListeningMessage,
    PreTestActiveListeningSession,
)
from models.user import User
from routers import pre_test_active_listening
from schemas.pre_test_active_listening import PreTestActiveListeningCompleteRequest


class FakeWebSocket:
    def __init__(self, messages):
        self._messages = iter(messages)
        self.accept = AsyncMock()
        self.send_json = AsyncMock()
        self.close = AsyncMock()

    async def receive(self):
        try:
            return next(self._messages)
        except StopIteration:
            raise WebSocketDisconnect


class StaticProvider:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    async def stream_chat(self, messages):
        self.calls.append([dict(message) for message in messages])
        response = next(self.responses)
        for chunk in response:
            yield chunk


class FailingProvider:
    async def stream_chat(self, messages):
        del messages
        if False:
            yield ""
        raise RuntimeError("mock provider failure")


class ActiveListeningPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.db = self.Session()
        self.db.add_all([
            User(
                id=7,
                email="owner@example.com",
                hashed_password="x",
                firstname="Owner",
                lastname="User",
                department="CCIT",
            ),
            User(
                id=8,
                email="other@example.com",
                hashed_password="x",
                firstname="Other",
                lastname="User",
                department="CCIT",
            ),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def create_session(self, *, user_id=7, status="active"):
        session = PreTestActiveListeningSession(user_id=user_id, status=status)
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def add_message(self, session_id, role, content):
        message = PreTestActiveListeningMessage(
            session_id=session_id,
            role=role,
            content=content,
        )
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return message

    def ordered_messages(self, session_id):
        return self.db.query(PreTestActiveListeningMessage).filter(
            PreTestActiveListeningMessage.session_id == session_id
        ).order_by(PreTestActiveListeningMessage.id.asc()).all()

    def run_chat(self, session_id, websocket, provider, *, current_user_id=7):
        with patch.object(pre_test_active_listening, "get_ai_provider", return_value=provider):
            asyncio.run(pre_test_active_listening.active_listening_chat_ws(
                websocket=websocket,
                session_id=session_id,
                db=self.db,
                current_user=SimpleNamespace(id=current_user_id),
            ))

    def test_start_creates_an_owned_active_session(self):
        session = pre_test_active_listening.start_session(
            db=self.db,
            current_user=SimpleNamespace(id=7),
        )

        self.assertEqual(session.user_id, 7)
        self.assertEqual(session.status, "active")
        self.assertEqual(
            self.db.query(PreTestActiveListeningSession).filter(
                PreTestActiveListeningSession.user_id == 7
            ).count(),
            1,
        )

    def test_user_and_completed_ai_turn_are_each_persisted_once(self):
        session = self.create_session()
        websocket = FakeWebSocket([
            {"text": json.dumps({"text": "/start_exercise"})},
            {"text": json.dumps({"text": "My summary"})},
        ])
        provider = StaticProvider([["Accurate ", "summary."]])

        self.run_chat(session.id, websocket, provider)

        messages = self.ordered_messages(session.id)
        self.assertEqual(
            [(message.role, message.content) for message in messages],
            [
                ("ai", pre_test_active_listening.get_active_listening_prompt(session.id)),
                ("user", "My summary"),
                ("ai", "Accurate summary."),
            ],
        )
        self.assertEqual(
            websocket.send_json.await_args_list[-1].args[0],
            {"type": "turn_complete", "message_id": messages[-1].id},
        )

    def test_multiple_turns_preserve_server_insertion_order(self):
        session = self.create_session()
        websocket = FakeWebSocket([
            {"text": json.dumps({"text": "/start_exercise"})},
            {"text": json.dumps({"text": "First summary"})},
            {"text": json.dumps({"text": "Follow-up answer"})},
        ])
        provider = StaticProvider([["First feedback."], ["Second feedback."]])

        self.run_chat(session.id, websocket, provider)

        messages = self.ordered_messages(session.id)
        self.assertEqual(
            [message.role for message in messages],
            ["ai", "user", "ai", "user", "ai"],
        )
        self.assertEqual([message.id for message in messages], sorted(message.id for message in messages))

    def test_provider_failure_preserves_user_without_fabricating_ai(self):
        session = self.create_session()
        websocket = FakeWebSocket([
            {"text": json.dumps({"text": "/start_exercise"})},
            {"text": json.dumps({"text": "Accepted summary"})},
        ])

        self.run_chat(session.id, websocket, FailingProvider())

        messages = self.ordered_messages(session.id)
        self.assertEqual([message.role for message in messages], ["ai", "user"])
        self.assertEqual(messages[-1].content, "Accepted summary")
        websocket.close.assert_awaited_once()

    def test_resume_replays_existing_ai_without_changing_history(self):
        session = self.create_session()
        self.add_message(session.id, "ai", "Story")
        self.add_message(session.id, "user", "Summary")
        feedback = self.add_message(session.id, "ai", "Feedback")
        original_ids = [message.id for message in self.ordered_messages(session.id)]
        websocket = FakeWebSocket([{"text": json.dumps({"text": "/start_exercise"})}])
        provider = StaticProvider([])

        self.run_chat(session.id, websocket, provider)

        self.assertEqual(
            [message.id for message in self.ordered_messages(session.id)],
            original_ids,
        )
        self.assertEqual(provider.calls, [])
        self.assertEqual(
            [call.args[0] for call in websocket.send_json.await_args_list],
            [
                {"text": "Feedback", "message_id": feedback.id},
                {"type": "turn_complete", "message_id": feedback.id},
            ],
        )

    def test_resume_retries_pending_user_without_duplicate_user_message(self):
        session = self.create_session()
        self.add_message(session.id, "ai", "Story")
        self.add_message(session.id, "user", "Preserved summary")
        websocket = FakeWebSocket([{"text": json.dumps({"text": "/start_exercise"})}])

        self.run_chat(session.id, websocket, StaticProvider([["Recovered feedback."]]))

        messages = self.ordered_messages(session.id)
        self.assertEqual([message.role for message in messages], ["ai", "user", "ai"])
        self.assertEqual(
            [message.content for message in messages if message.role == "user"],
            ["Preserved summary"],
        )

    def test_completion_reuses_persisted_history_without_bulk_duplicates(self):
        session = self.create_session()
        self.add_message(session.id, "ai", "Story")
        self.add_message(session.id, "user", "Summary")
        self.add_message(session.id, "ai", "Feedback")
        original_ids = [message.id for message in self.ordered_messages(session.id)]
        request = PreTestActiveListeningCompleteRequest(
            conversation=[
                {"sender": "ai", "text": "Story"},
                {"sender": "user", "text": "Summary"},
                {"sender": "ai", "text": "Feedback"},
            ],
            evaluation={
                "score_vocabulary": 4,
                "score_clarity": 4,
                "score_grammar": 4,
                "score_courtesy": 4,
                "score_conciseness": 4,
                "eye_contact_samples": 0,
            },
        )

        result = pre_test_active_listening.complete_session(
            session_id=session.id,
            request=request,
            db=self.db,
            current_user=SimpleNamespace(id=7),
        )

        self.assertEqual(
            [message.id for message in self.ordered_messages(session.id)],
            original_ids,
        )
        self.assertEqual(result.status, "completed")

    def test_completed_and_unowned_sessions_reject_websocket_turns(self):
        completed_session = self.create_session(status="completed")
        completed_socket = FakeWebSocket([])
        self.run_chat(completed_session.id, completed_socket, StaticProvider([]))
        completed_socket.close.assert_awaited_once()
        self.assertEqual(completed_socket.close.await_args.kwargs["code"], 1008)

        owned_session = self.create_session(user_id=7)
        unowned_socket = FakeWebSocket([])
        self.run_chat(
            owned_session.id,
            unowned_socket,
            StaticProvider([]),
            current_user_id=8,
        )
        unowned_socket.close.assert_awaited_once()
        self.assertEqual(unowned_socket.close.await_args.kwargs["code"], 1008)


if __name__ == "__main__":
    unittest.main()

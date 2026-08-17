import asyncio
import datetime
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, WebSocketDisconnect

from models.thesis_interview import ThesisInterviewMessage, ThesisInterviewSession
from models.upcoming_student_interview import (
    UpcomingStudentInterviewMessage,
    UpcomingStudentInterviewSession,
)
from routers import thesis_interview, upcoming_student_interview
from schemas.thesis_interview import ThesisCompleteInterviewRequest
from schemas.upcoming_student_interview import UpcomingStudentCompleteInterviewRequest
from services.ai_provider import AIProviderUnavailableError
from services.interview_ai import parse_evaluation_response


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
    def __init__(self, response: str):
        self.response = response
        self.calls = []

    async def stream_chat(self, messages, workload=None):
        self.calls.append(([dict(message) for message in messages], workload))
        yield self.response


class FailingProvider:
    async def stream_chat(self, messages, workload=None):
        del messages, workload
        if False:
            yield ""
        raise AIProviderUnavailableError("provider-secret-detail")


class FakeQuery:
    def __init__(self, *, first_value=None, all_values=None):
        self.first_value = first_value
        self.all_values = all_values if all_values is not None else []

    def filter(self, *args, **kwargs):
        del args, kwargs
        return self

    def order_by(self, *args, **kwargs):
        del args, kwargs
        return self

    def first(self):
        return self.first_value

    def all(self):
        return list(self.all_values)


class FakeInterviewDatabase:
    def __init__(self, session, session_model, message_model, messages=None):
        self.session = session
        self.session_model = session_model
        self.message_model = message_model
        self.messages = list(messages or [])
        self.commit_count = 0
        self.rollback_count = 0

    def query(self, model):
        if model is self.session_model:
            return FakeQuery(first_value=self.session)
        if model is self.message_model:
            return FakeQuery(all_values=self.messages)
        raise AssertionError(f"Unexpected query model: {model}")

    def add(self, value):
        if isinstance(value, self.message_model):
            if value.timestamp is None:
                value.timestamp = datetime.datetime.utcnow()
            self.messages.append(value)

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def refresh(self, value):
        del value


def active_session(session_id=1):
    return SimpleNamespace(
        id=session_id,
        user_id=7,
        status="active",
        start_time=datetime.datetime.utcnow(),
        end_time=None,
        total_score=None,
        passed=None,
        feedback_summary=None,
        abstract_s3_key=None,
    )


def stored_message(message_model, session_id, role, content):
    return message_model(
        session_id=session_id,
        role=role,
        content=content,
        timestamp=datetime.datetime.utcnow(),
    )


class OnlineConversationTests(unittest.TestCase):
    def test_enrollment_conversation_uses_ai_provider(self):
        session = active_session(11)
        database = FakeInterviewDatabase(
            session,
            UpcomingStudentInterviewSession,
            UpcomingStudentInterviewMessage,
        )
        websocket = FakeWebSocket([{"text": json.dumps({"type": "start"})}])
        provider = StaticProvider("Welcome. What major are you pursuing?")

        with patch.object(upcoming_student_interview, "get_ai_provider", return_value=provider):
            asyncio.run(upcoming_student_interview.interview_chat_ws(
                websocket=websocket,
                session_id=session.id,
                db=database,
                current_user=SimpleNamespace(id=7, department="CCIT"),
            ))

        self.assertEqual(provider.calls[0][1], "enrollment_interview")
        self.assertEqual(database.messages[-1].role, "ai")
        self.assertEqual(
            [call.args[0] for call in websocket.send_json.await_args_list],
            [
                {"text": "Welcome. What major are you pursuing?"},
                {"type": "turn_complete"},
            ],
        )

    def test_thesis_conversation_uses_ai_provider_and_browser_abstract(self):
        session = active_session(12)
        database = FakeInterviewDatabase(
            session,
            ThesisInterviewSession,
            ThesisInterviewMessage,
        )
        websocket = FakeWebSocket([{
            "text": json.dumps({"type": "start", "abstract_text": "A trusted abstract."}),
        }])
        provider = StaticProvider("Describe your system architecture.")

        with patch.object(thesis_interview, "get_ai_provider", return_value=provider):
            asyncio.run(thesis_interview.interview_chat_ws(
                websocket=websocket,
                session_id=session.id,
                db=database,
                current_user=SimpleNamespace(id=7, department="CCIT"),
            ))

        messages, workload = provider.calls[0]
        self.assertEqual(workload, "thesis_interview")
        self.assertIn("A trusted abstract.", messages[0]["content"])
        self.assertEqual(database.messages[-1].role, "ai")


class AuthoritativeEvaluationTests(unittest.TestCase):
    def test_provider_failure_keeps_enrollment_active_without_fake_scores(self):
        session = active_session(21)
        messages = [
            stored_message(UpcomingStudentInterviewMessage, 21, "ai", "Question"),
            stored_message(UpcomingStudentInterviewMessage, 21, "user", "Answer"),
        ]
        database = FakeInterviewDatabase(
            session,
            UpcomingStudentInterviewSession,
            UpcomingStudentInterviewMessage,
            messages,
        )
        request = UpcomingStudentCompleteInterviewRequest(
            conversation=[],
            evaluation={"technical_score": 100, "eye_contact_samples": 0},
        )

        with patch.object(upcoming_student_interview, "get_ai_provider", return_value=FailingProvider()):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(upcoming_student_interview.complete_interview(
                    session_id=session.id,
                    request=request,
                    db=database,
                    current_user=SimpleNamespace(id=7, department="CCIT"),
                ))

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(session.status, "active")
        self.assertIsNone(session.total_score)
        self.assertGreaterEqual(database.rollback_count, 1)

    def test_enrollment_server_scores_are_bounded_and_client_scores_are_ignored(self):
        session = active_session(22)
        messages = [
            stored_message(UpcomingStudentInterviewMessage, 22, "ai", "Question"),
            stored_message(UpcomingStudentInterviewMessage, 22, "user", "Answer"),
        ]
        database = FakeInterviewDatabase(
            session,
            UpcomingStudentInterviewSession,
            UpcomingStudentInterviewMessage,
            messages,
        )
        provider = StaticProvider(json.dumps({
            "technical_score": 150,
            "problem_solving_score": -20,
            "coding_score": 80,
            "communication_score": 70,
            "soft_skills_score": 60,
            "feedback_summary": "Server-generated feedback.",
        }))
        request = UpcomingStudentCompleteInterviewRequest(
            conversation=[],
            evaluation={
                "technical_score": 1,
                "eye_contact_score": 120,
                "eye_contact_samples": 8,
            },
        )

        with patch.object(upcoming_student_interview, "get_ai_provider", return_value=provider):
            result = asyncio.run(upcoming_student_interview.complete_interview(
                session_id=session.id,
                request=request,
                db=database,
                current_user=SimpleNamespace(id=7, department="CCIT"),
            ))

        self.assertIs(result, session)
        self.assertEqual(provider.calls[0][1], "enrollment_evaluation")
        self.assertEqual(session.score_technical, 100)
        self.assertEqual(session.score_problem_solving, 0)
        self.assertEqual(session.score_eye_contact, 100)
        self.assertEqual(session.status, "completed")

    def test_thesis_completion_uses_server_provider_and_keeps_contract(self):
        session = active_session(23)
        messages = [
            stored_message(ThesisInterviewMessage, 23, "ai", "Question"),
            stored_message(ThesisInterviewMessage, 23, "user", "Answer"),
        ]
        database = FakeInterviewDatabase(
            session,
            ThesisInterviewSession,
            ThesisInterviewMessage,
            messages,
        )
        provider = StaticProvider(json.dumps({
            "technical_innovation_score": 90,
            "system_implementation_score": 85,
            "experimental_validation_score": 80,
            "literature_review_score": 75,
            "demo_quality_score": 70,
            "feedback_summary": "Server thesis feedback.",
        }))

        with patch.object(thesis_interview, "get_ai_provider", return_value=provider):
            result = asyncio.run(thesis_interview.complete_interview(
                session_id=session.id,
                request=ThesisCompleteInterviewRequest(
                    conversation=[],
                    evaluation={"eye_contact_samples": 0},
                ),
                db=database,
                current_user=SimpleNamespace(id=7, department="CCIT"),
            ))

        self.assertIs(result, session)
        self.assertEqual(provider.calls[0][1], "thesis_evaluation")
        self.assertEqual(session.score_ccit_technical_innovation, 90)
        self.assertEqual(session.status, "completed")
        self.assertIsInstance(session.total_score, float)

    def test_invalid_evaluation_contract_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_evaluation_response(
                '{"technical_score": "100", "feedback_summary": "Feedback"}',
                ["technical_score"],
            )


if __name__ == "__main__":
    unittest.main()

import asyncio
import datetime
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
)
from fastapi import WebSocketDisconnect

from core.ai import close_ai_unavailable, get_ai_unavailable_message
from core.config import AISettings, resolve_ai_settings
from services.ai_provider import (
    AIAuthenticationError,
    AIConfigurationError,
    AIEmptyResponseError,
    AIInterruptedStreamError,
    AIProviderUnavailableError,
    AIRateLimitError,
    AITimeoutError,
    GeminiAIProvider,
    OllamaAIProvider,
    get_ai_provider,
    normalize_gemini_base_url,
    normalize_ollama_base_url,
)
from routers import pre_test_active_listening


def ollama_settings(**overrides) -> AISettings:
    values = {
        "provider": "ollama",
        "api_key": "ollama",
        "base_url": "http://localhost:11434",
        "model": "llama3.1:8b",
        "timeout_seconds": 180.0,
    }
    values.update(overrides)
    return AISettings(**values)


def gemini_settings(**overrides) -> AISettings:
    values = {
        "provider": "gemini",
        "api_key": "unit-test-server-key",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-3.6-flash",
        "timeout_seconds": 180.0,
    }
    values.update(overrides)
    return AISettings(**values)


class FakeStream:
    def __init__(self, chunks, error=None):
        self._chunks = iter(chunks)
        self._error = error
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._chunks)
        except StopIteration:
            if self._error is not None:
                error = self._error
                self._error = None
                raise error
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


class FakeClient:
    def __init__(self, *, stream=None, error=None):
        self.create = AsyncMock(side_effect=error, return_value=stream)
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self.create),
        )


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


class StaticTextProvider:
    def __init__(self, responses):
        self.responses = responses
        self.received_messages = None

    async def stream_chat(self, messages, workload=None):
        del workload
        self.received_messages = [dict(message) for message in messages]
        for response in self.responses:
            yield response


class FailingProvider:
    def __init__(self, error):
        self.error = error

    async def stream_chat(self, messages, workload=None):
        del messages, workload
        if False:
            yield ""
        raise self.error


def chunk(content):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=content))],
    )


async def collect_stream(provider, workload=None):
    return [text async for text in provider.stream_chat(
        [{"role": "user", "content": "Hello"}],
        workload=workload,
    )]


class AIConfigurationTests(unittest.TestCase):
    def test_ollama_is_the_default_provider(self):
        configuration = resolve_ai_settings({})

        self.assertEqual(configuration.provider, "ollama")
        self.assertEqual(configuration.api_key, "ollama")
        self.assertEqual(configuration.model, "llama3.1:8b")

    def test_legacy_ollama_values_are_used_as_fallbacks(self):
        configuration = resolve_ai_settings({
            "OLLAMA_BASE_URL": "http://legacy-host:11434/",
            "OLLAMA_MODEL": "legacy-model",
        })

        self.assertEqual(configuration.base_url, "http://legacy-host:11434/")
        self.assertEqual(configuration.model, "legacy-model")

    def test_provider_neutral_values_override_legacy_ollama_values(self):
        configuration = resolve_ai_settings({
            "AI_PROVIDER": "ollama",
            "AI_BASE_URL": "http://preferred-host:11434",
            "AI_MODEL": "preferred-model",
            "OLLAMA_BASE_URL": "http://legacy-host:11434",
            "OLLAMA_MODEL": "legacy-model",
        })

        self.assertEqual(configuration.base_url, "http://preferred-host:11434")
        self.assertEqual(configuration.model, "preferred-model")

    def test_invalid_timeout_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "positive number"):
            resolve_ai_settings({"AI_TIMEOUT_SECONDS": "0"})

    def test_unknown_provider_is_rejected(self):
        with self.assertRaises(AIConfigurationError):
            get_ai_provider(ollama_settings(provider="cloud"))

    def test_gemini_defaults_do_not_use_legacy_ollama_values(self):
        configuration = resolve_ai_settings({
            "AI_PROVIDER": "gemini",
            "AI_API_KEY": "unit-test-server-key",
            "OLLAMA_BASE_URL": "http://legacy-host:11434",
            "OLLAMA_MODEL": "legacy-model",
        })

        self.assertEqual(
            configuration.base_url,
            "https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        self.assertEqual(configuration.model, "gemini-3.6-flash")

    def test_gemini_provider_neutral_overrides_are_used(self):
        configuration = resolve_ai_settings({
            "AI_PROVIDER": "gemini",
            "AI_API_KEY": "unit-test-server-key",
            "AI_BASE_URL": "https://gemini-proxy.example/openai",
            "AI_MODEL": "gemini-custom-model",
            "AI_TIMEOUT_SECONDS": "45",
        })

        self.assertEqual(configuration.base_url, "https://gemini-proxy.example/openai")
        self.assertEqual(configuration.model, "gemini-custom-model")
        self.assertEqual(configuration.timeout_seconds, 45.0)

    def test_gemini_requires_server_api_key(self):
        configuration = resolve_ai_settings({"AI_PROVIDER": "gemini"})

        with self.assertRaises(AIConfigurationError):
            get_ai_provider(configuration)


class OllamaProviderTests(unittest.TestCase):
    def test_url_normalization_has_exactly_one_v1_suffix(self):
        inputs = (
            "http://localhost:11434",
            "http://localhost:11434/",
            "http://localhost:11434/v1",
            "http://localhost:11434/v1/",
            "http://localhost:11434/v1/v1/",
        )

        for value in inputs:
            with self.subTest(value=value):
                self.assertEqual(
                    normalize_ollama_base_url(value),
                    "http://localhost:11434/v1",
                )

    def test_client_receives_explicit_timeout_and_normalized_url(self):
        with patch("services.ai_provider.AsyncOpenAI") as client_constructor:
            provider = get_ai_provider(ollama_settings(timeout_seconds=42.0))

        self.assertIsInstance(provider, OllamaAIProvider)
        self.assertEqual(provider.timeout_seconds, 42.0)
        client_constructor.assert_called_once_with(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            timeout=42.0,
        )

    def test_stream_chunks_are_normalized_to_text_and_stream_is_closed(self):
        stream = FakeStream([chunk("Hello"), chunk(None), chunk(" world")])
        client = FakeClient(stream=stream)
        provider = OllamaAIProvider(ollama_settings(), client=client)

        result = asyncio.run(collect_stream(provider))

        self.assertEqual(result, ["Hello", " world"])
        self.assertTrue(stream.closed)
        client.create.assert_awaited_once_with(
            model="llama3.1:8b",
            messages=[{"role": "user", "content": "Hello"}],
            stream=True,
        )

    def test_empty_stream_raises_normalized_error(self):
        stream = FakeStream([])
        provider = OllamaAIProvider(
            ollama_settings(),
            client=FakeClient(stream=stream),
        )

        with self.assertRaises(AIEmptyResponseError):
            asyncio.run(collect_stream(provider))
        self.assertTrue(stream.closed)

    def test_provider_exceptions_are_mapped(self):
        request = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
        response_401 = httpx.Response(401, request=request)
        response_429 = httpx.Response(429, request=request)
        cases = (
            (APITimeoutError(request), AITimeoutError),
            (APIConnectionError(request=request), AIProviderUnavailableError),
            (
                AuthenticationError("secret detail", response=response_401, body=None),
                AIAuthenticationError,
            ),
            (
                RateLimitError("rate detail", response=response_429, body=None),
                AIRateLimitError,
            ),
        )

        for original_error, expected_error in cases:
            with self.subTest(expected_error=expected_error.__name__):
                provider = OllamaAIProvider(
                    ollama_settings(),
                    client=FakeClient(error=original_error),
                )
                with self.assertRaises(expected_error) as raised:
                    asyncio.run(collect_stream(provider))
                self.assertNotIn("secret detail", str(raised.exception))
                self.assertNotIn("rate detail", str(raised.exception))

    def test_connection_failure_after_content_is_an_interrupted_stream(self):
        request = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
        stream = FakeStream(
            [chunk("partial")],
            error=APIConnectionError(request=request),
        )
        provider = OllamaAIProvider(
            ollama_settings(),
            client=FakeClient(stream=stream),
        )

        with self.assertRaises(AIInterruptedStreamError):
            asyncio.run(collect_stream(provider))
        self.assertTrue(stream.closed)


class GeminiProviderTests(unittest.TestCase):
    def test_gemini_selection_and_client_configuration(self):
        with patch("services.ai_provider.AsyncOpenAI") as client_constructor:
            provider = get_ai_provider(gemini_settings(timeout_seconds=36.0))

        self.assertIsInstance(provider, GeminiAIProvider)
        self.assertEqual(provider.model, "gemini-3.6-flash")
        self.assertEqual(provider.timeout_seconds, 36.0)
        client_constructor.assert_called_once_with(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            api_key="unit-test-server-key",
            timeout=36.0,
        )

    def test_gemini_url_normalization_preserves_openai_path(self):
        inputs = (
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "https://generativelanguage.googleapis.com/v1beta/openai/",
        )

        for value in inputs:
            with self.subTest(value=value):
                normalized = normalize_gemini_base_url(value)
                self.assertEqual(
                    normalized,
                    "https://generativelanguage.googleapis.com/v1beta/openai/",
                )
                self.assertNotIn("/openai/v1", normalized)

    def test_gemini_custom_base_url_gets_only_a_trailing_slash(self):
        self.assertEqual(
            normalize_gemini_base_url("https://gemini-proxy.example/custom/openai"),
            "https://gemini-proxy.example/custom/openai/",
        )

    def test_gemini_rejects_unsafe_base_urls(self):
        invalid_urls = (
            "ftp://generativelanguage.googleapis.com/v1beta/openai/",
            "https://generativelanguage.googleapis.com/v1beta/openai/?query=bad",
            "https://generativelanguage.googleapis.com/v1beta/openai/#fragment",
            "not-a-url",
        )

        for value in invalid_urls:
            with self.subTest(value=value):
                with self.assertRaises(AIConfigurationError):
                    normalize_gemini_base_url(value)

    def test_gemini_stream_uses_minimal_parameters_and_normalizes_text(self):
        stream = FakeStream([
            chunk("First"),
            chunk(None),
            chunk({"not": "text"}),
            chunk(" response"),
        ])
        client = FakeClient(stream=stream)
        provider = GeminiAIProvider(gemini_settings(), client=client)

        result = asyncio.run(collect_stream(provider, workload="thesis"))

        self.assertEqual(result, ["First", " response"])
        self.assertTrue(stream.closed)
        request = client.create.await_args.kwargs
        self.assertEqual(set(request), {"model", "messages", "stream"})
        self.assertEqual(request["model"], "gemini-3.6-flash")
        self.assertTrue(request["stream"])
        self.assertNotIn("temperature", request)
        self.assertNotIn("top_p", request)
        self.assertNotIn("top_k", request)

    def test_empty_or_malformed_gemini_stream_is_rejected(self):
        malformed_chunk = SimpleNamespace(not_choices=[])
        provider = GeminiAIProvider(
            gemini_settings(),
            client=FakeClient(stream=FakeStream([malformed_chunk, chunk(None)])),
        )

        with self.assertRaises(AIEmptyResponseError):
            asyncio.run(collect_stream(provider))

    def test_gemini_provider_exceptions_use_neutral_categories(self):
        request = httpx.Request(
            "POST",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        cases = (
            (
                AuthenticationError(
                    "provider-secret-detail",
                    response=httpx.Response(401, request=request),
                    body=None,
                ),
                AIAuthenticationError,
            ),
            (
                RateLimitError(
                    "provider-quota-detail",
                    response=httpx.Response(429, request=request),
                    body=None,
                ),
                AIRateLimitError,
            ),
            (APITimeoutError(request), AITimeoutError),
            (APIConnectionError(request=request), AIProviderUnavailableError),
            (
                NotFoundError(
                    "invalid-model-detail",
                    response=httpx.Response(404, request=request),
                    body=None,
                ),
                AIConfigurationError,
            ),
        )

        for original_error, expected_error in cases:
            with self.subTest(expected_error=expected_error.__name__):
                provider = GeminiAIProvider(
                    gemini_settings(),
                    client=FakeClient(error=original_error),
                )
                with self.assertRaises(expected_error) as raised:
                    asyncio.run(collect_stream(provider))
                public_error = str(raised.exception)
                self.assertNotIn("provider-secret-detail", public_error)
                self.assertNotIn("provider-quota-detail", public_error)
                self.assertNotIn("invalid-model-detail", public_error)

    def test_gemini_midstream_failure_is_normalized_and_closed(self):
        request = httpx.Request(
            "POST",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        stream = FakeStream(
            [chunk("partial")],
            error=APIConnectionError(request=request),
        )
        provider = GeminiAIProvider(
            gemini_settings(),
            client=FakeClient(stream=stream),
        )

        with self.assertRaises(AIInterruptedStreamError):
            asyncio.run(collect_stream(provider))
        self.assertTrue(stream.closed)


class ProviderContractTests(unittest.TestCase):
    def test_user_facing_unavailable_error_is_provider_neutral(self):
        websocket = SimpleNamespace(
            send_json=AsyncMock(),
            close=AsyncMock(),
        )

        asyncio.run(close_ai_unavailable(websocket))

        message = get_ai_unavailable_message()
        self.assertEqual(
            message,
            "The AI service is temporarily unavailable. Please try again.",
        )
        self.assertNotIn("Ollama", message)
        websocket.send_json.assert_awaited_once_with({
            "type": "error",
            "message": message,
        })

    def test_active_listening_websocket_keeps_streaming_contract(self):
        session = SimpleNamespace(
            id=17,
            user_id=3,
            status="active",
            start_time=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
        )
        database = MagicMock()
        database.query.return_value.filter.return_value.first.return_value = session
        websocket = FakeWebSocket([
            {"text": json.dumps({"text": "My summary"})},
        ])
        provider = StaticTextProvider(["Helpful ", "feedback."])

        with patch.object(
            pre_test_active_listening,
            "get_ai_provider",
            return_value=provider,
        ):
            asyncio.run(pre_test_active_listening.active_listening_chat_ws(
                websocket=websocket,
                session_id=session.id,
                db=database,
                current_user=SimpleNamespace(id=3),
            ))

        websocket.accept.assert_awaited_once_with()
        self.assertEqual(
            [call.args[0] for call in websocket.send_json.await_args_list],
            [
                {"text": "Helpful "},
                {"text": "feedback."},
                {"type": "turn_complete"},
            ],
        )
        self.assertEqual(provider.received_messages[-1], {
            "role": "user",
            "content": "My summary",
        })

    def test_public_error_and_router_log_do_not_expose_secret_details(self):
        session = SimpleNamespace(
            id=18,
            user_id=3,
            status="active",
            start_time=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
        )
        database = MagicMock()
        database.query.return_value.filter.return_value.first.return_value = session
        websocket = FakeWebSocket([
            {"text": json.dumps({"text": "Student response"})},
        ])
        secret_detail = "sensitive-unit-test-token"

        with patch.object(
            pre_test_active_listening,
            "get_ai_provider",
            return_value=FailingProvider(AIAuthenticationError(secret_detail)),
        ), self.assertLogs(pre_test_active_listening.logger.name, level="WARNING") as logs:
            asyncio.run(pre_test_active_listening.active_listening_chat_ws(
                websocket=websocket,
                session_id=session.id,
                db=database,
                current_user=SimpleNamespace(id=3),
            ))

        public_payloads = [call.args[0] for call in websocket.send_json.await_args_list]
        self.assertNotIn(secret_detail, str(public_payloads))
        self.assertNotIn(secret_detail, "\n".join(logs.output))
        self.assertIn("AIAuthenticationError", "\n".join(logs.output))

    def test_all_mounted_ai_routers_use_the_provider_abstraction(self):
        backend_root = Path(__file__).resolve().parents[1]
        router_paths = (
            "routers/pre_test_active_listening.py",
            "routers/upcoming_student_interview.py",
            "routers/thesis_interview.py",
            "routers/custom_skills.py",
        )

        for relative_path in router_paths:
            source = (backend_root / relative_path).read_text(encoding="utf-8")
            with self.subTest(router=relative_path):
                self.assertIn("get_ai_provider", source)
                self.assertIn(".stream_chat(", source)
                self.assertNotIn("get_ollama_client", source)
                self.assertNotIn("AsyncOpenAI", source)
                self.assertNotIn("chat.completions.create", source)
                self.assertNotIn("GeminiAIProvider", source)
                self.assertNotIn("AI_API_KEY", source)

    def test_server_ai_api_key_is_not_referenced_by_frontend_runtime(self):
        frontend_root = Path(__file__).resolve().parents[2] / "Frontend" / "src"
        for path in frontend_root.rglob("*"):
            if not path.is_file() or path.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
                continue
            with self.subTest(path=path.name):
                self.assertNotIn("AI_API_KEY", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

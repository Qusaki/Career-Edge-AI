import io
import logging
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.config import AISettings
from core.deps import get_current_user
from routers import speech
from services.ai_provider import AIProviderUnavailableError, GeminiAIProvider, OllamaAIProvider


WEBM = b"\x1a\x45\xdf\xa3" + b"\0" * 300
OGG = b"OggS" + b"\0" * 300
MP4 = b"\0\0\0\x18ftypM4A " + b"\0" * 300


class FakeTranscriber:
    def __init__(self, transcript="Um, I think so, I think so."):
        self.transcript = transcript
        self.calls = []

    async def transcribe_audio(self, audio, mime_type):
        self.calls.append((audio, mime_type))
        if isinstance(self.transcript, Exception):
            raise self.transcript
        return self.transcript


class SpeechEndpointTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(speech.router, prefix="/speech")
        self.client = TestClient(app)
        self.app = app
        self.provider = FakeTranscriber()
        self.provider_patch = patch.object(speech, "get_ai_provider", return_value=self.provider)
        self.provider_patch.start()

    def tearDown(self):
        self.provider_patch.stop()
        self.client.close()

    def authenticate(self):
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)

    def upload(self, data=WEBM, mime="audio/webm;codecs=opus"):
        return self.client.post("/speech/transcribe", files={"file": ("ignored.bin", io.BytesIO(data), mime)})

    def test_authentication_required(self):
        self.assertEqual(self.upload().status_code, 401)
        self.assertEqual(self.provider.calls, [])

    def test_valid_webm_transcribes_verbatim(self):
        self.authenticate()
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"transcript": self.provider.transcript})
        self.assertEqual(self.provider.calls, [(WEBM, "audio/webm")])

    def test_valid_ogg_alternate(self):
        self.authenticate()
        self.assertEqual(self.upload(OGG, "audio/ogg").status_code, 200)
        self.assertEqual(self.provider.calls[0][1], "audio/ogg")

    def test_browser_mp4_audio_uses_supported_m4a_type(self):
        self.authenticate()
        self.assertEqual(self.upload(MP4, "audio/mp4").status_code, 200)
        self.assertEqual(self.provider.calls[0][1], "audio/m4a")

    def test_unsupported_and_spoofed_media_rejected(self):
        self.authenticate()
        self.assertEqual(self.upload(WEBM, "image/png").status_code, 415)
        self.assertEqual(self.upload(b"not webm", "audio/webm").status_code, 415)
        self.assertEqual(self.provider.calls, [])

    def test_empty_and_oversized_rejected(self):
        self.authenticate()
        self.assertEqual(self.upload(b"").status_code, 400)
        with patch.object(speech, "MAX_TRANSCRIPTION_BYTES", 100):
            self.assertEqual(self.upload(WEBM).status_code, 413)
        self.assertEqual(self.provider.calls, [])

    def test_provider_failure_sanitized_and_audio_not_logged(self):
        self.authenticate()
        self.provider.transcript = AIProviderUnavailableError("secret provider details")
        with self.assertLogs(speech.logger, level=logging.WARNING) as logs:
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret provider details", response.text + " ".join(logs.output))
        self.assertNotIn("ignored.bin", " ".join(logs.output))

    def test_empty_transcript_rejected(self):
        self.authenticate()
        for transcript in ("", "  \n "):
            self.provider.transcript = transcript
            self.assertEqual(self.upload().status_code, 422)


class GeminiTranscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_dedicated_model_verbatim_auto_language_and_no_chat_path(self):
        settings = AISettings(
            provider="gemini", api_key="test-key", base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            model="chat-model", timeout_seconds=30, transcription_model="gemini-3.5-transcribe",
        )
        provider = GeminiAIProvider(settings)
        response = httpx.Response(200, json={"status": "completed", "steps": [
            {"type": "model_output", "content": [{"type": "text", "text": "Um, I I agree."}]},
        ]}, request=httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/interactions"))
        fake_http = AsyncMock()
        fake_http.post = AsyncMock(return_value=response)
        fake_http.__aenter__.return_value = fake_http
        with patch("services.ai_provider.httpx.AsyncClient", return_value=fake_http):
            text = await provider.transcribe_audio(WEBM, "audio/webm")
        self.assertEqual(text, "Um, I I agree.")
        request = fake_http.post.call_args
        self.assertEqual(request.kwargs["json"]["model"], "gemini-3.5-transcribe")
        self.assertIs(request.kwargs["json"]["store"], False)
        self.assertEqual(request.kwargs["json"]["generation_config"]["transcription_config"],
                         {"mode": {"type": "verbatim"}, "language_codes": []})
        self.assertEqual(request.kwargs["json"]["input"][0]["mime_type"], "audio/webm")

    async def test_ollama_does_not_fake_transcription(self):
        from services.ai_provider import AIConfigurationError
        provider = OllamaAIProvider(AISettings("ollama", "ollama", "http://localhost:11434", "local", 30))
        with self.assertRaises(AIConfigurationError):
            await provider.transcribe_audio(WEBM, "audio/webm")

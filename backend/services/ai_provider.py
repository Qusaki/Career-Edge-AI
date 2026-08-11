import asyncio
import inspect
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import suppress
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit

# pyrefly: ignore [missing-import]
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)

from core.config import AISettings, resolve_ai_settings


class AIProviderError(RuntimeError):
    """Base class for errors exposed by the provider-neutral AI service."""


class AIConfigurationError(AIProviderError):
    pass


class AIAuthenticationError(AIProviderError):
    pass


class AIRateLimitError(AIProviderError):
    pass


class AITimeoutError(AIProviderError):
    pass


class AIProviderUnavailableError(AIProviderError):
    pass


class AIInterruptedStreamError(AIProviderError):
    pass


class AIEmptyResponseError(AIProviderError):
    pass


ChatMessage = Mapping[str, str]


class AIProvider(Protocol):
    @property
    def model(self) -> str: ...

    def stream_chat(
        self,
        messages: Sequence[ChatMessage],
        workload: str | None = None,
    ) -> AsyncIterator[str]: ...


def normalize_ollama_base_url(base_url: str) -> str:
    """Return an Ollama OpenAI-compatible URL with exactly one /v1 suffix."""
    raw_url = base_url.strip()
    if not raw_url:
        raise AIConfigurationError("The AI service base URL is not configured.")

    parsed = urlsplit(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AIConfigurationError("The AI service base URL is invalid.")
    if parsed.query or parsed.fragment:
        raise AIConfigurationError("The AI service base URL is invalid.")

    path = parsed.path.rstrip("/")
    while path.endswith("/v1"):
        path = path[:-3].rstrip("/")
    normalized_path = f"{path}/v1" if path else "/v1"
    return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, "", ""))


def normalize_gemini_base_url(base_url: str) -> str:
    """Return a validated Gemini-compatible base URL with one trailing slash."""
    raw_url = base_url.strip()
    if not raw_url:
        raise AIConfigurationError("The AI service base URL is not configured.")

    parsed = urlsplit(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AIConfigurationError("The AI service base URL is invalid.")
    if parsed.query or parsed.fragment:
        raise AIConfigurationError("The AI service base URL is invalid.")

    normalized_path = f"{parsed.path.rstrip('/')}/"
    return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, "", ""))


def _mapped_provider_error(
    error: Exception,
    *,
    stream_started: bool,
) -> AIProviderError:
    if isinstance(error, AuthenticationError):
        return AIAuthenticationError("The AI service authentication failed.")
    if isinstance(error, RateLimitError):
        return AIRateLimitError("The AI service rate limit was reached.")
    if isinstance(error, (APITimeoutError, asyncio.TimeoutError)):
        return AITimeoutError("The AI service request timed out.")
    if isinstance(error, APIStatusError):
        if error.status_code in {401, 403}:
            return AIAuthenticationError("The AI service authentication failed.")
        if error.status_code == 429:
            return AIRateLimitError("The AI service rate limit was reached.")
        if error.status_code in {408, 504}:
            return AITimeoutError("The AI service request timed out.")
        if error.status_code in {400, 404, 422}:
            return AIConfigurationError("The AI service request is not configured correctly.")
    if stream_started:
        return AIInterruptedStreamError("The AI service stream was interrupted.")
    if isinstance(error, APIConnectionError):
        return AIProviderUnavailableError("The AI service is unavailable.")
    return AIProviderUnavailableError("The AI service is unavailable.")


async def _close_stream(stream: object | None) -> None:
    if stream is None:
        return

    close = getattr(stream, "close", None)
    if not callable(close):
        return

    with suppress(Exception):
        result = close()
        if inspect.isawaitable(result):
            await result


class _OpenAICompatibleAIProvider:
    def __init__(
        self,
        configuration: AISettings,
        normalized_base_url: str,
        client: AsyncOpenAI | None = None,
    ) -> None:
        if not configuration.model:
            raise AIConfigurationError("The AI service model is not configured.")

        self._model = configuration.model
        self._base_url = normalized_base_url
        self._timeout_seconds = configuration.timeout_seconds
        self._client = client or AsyncOpenAI(
            base_url=self._base_url,
            api_key=configuration.api_key,
            timeout=self._timeout_seconds,
        )

    @property
    def client(self) -> AsyncOpenAI:
        """Temporary compatibility access for backend/core/ai.py only."""
        return self._client

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def model(self) -> str:
        return self._model

    @property
    def timeout_seconds(self) -> float:
        return self._timeout_seconds

    async def stream_chat(
        self,
        messages: Sequence[ChatMessage],
        workload: str | None = None,
    ) -> AsyncIterator[str]:
        del workload  # Reserved for future workload-specific model selection.
        stream = None
        received_content = False

        try:
            stream = await self._client.chat.completions.create(
                model=self._model,
                messages=[dict(message) for message in messages],
                stream=True,
            )

            async for chunk in stream:
                choices = getattr(chunk, "choices", None)
                if not choices:
                    continue
                delta = getattr(choices[0], "delta", None)
                content = getattr(delta, "content", None)
                if not isinstance(content, str) or not content:
                    continue
                received_content = True
                yield content
        except asyncio.CancelledError:
            raise
        except AIProviderError:
            raise
        except Exception as error:
            raise _mapped_provider_error(
                error,
                stream_started=received_content,
            ) from error
        finally:
            await _close_stream(stream)

        if not received_content:
            raise AIEmptyResponseError("The AI service returned an empty response.")


class OllamaAIProvider(_OpenAICompatibleAIProvider):
    """Ollama adapter using its OpenAI-compatible chat-completions API."""

    def __init__(
        self,
        configuration: AISettings,
        client: AsyncOpenAI | None = None,
    ) -> None:
        super().__init__(
            configuration,
            normalized_base_url=normalize_ollama_base_url(configuration.base_url),
            client=client,
        )


class GeminiAIProvider(_OpenAICompatibleAIProvider):
    """Gemini Server API adapter using Google's OpenAI-compatible endpoint."""

    def __init__(
        self,
        configuration: AISettings,
        client: AsyncOpenAI | None = None,
    ) -> None:
        if not configuration.api_key:
            raise AIConfigurationError("The Gemini AI provider requires AI_API_KEY.")
        super().__init__(
            configuration,
            normalized_base_url=normalize_gemini_base_url(configuration.base_url),
            client=client,
        )


def get_ai_provider(
    configuration: AISettings | None = None,
    client: AsyncOpenAI | None = None,
) -> AIProvider:
    resolved = configuration or resolve_ai_settings()
    if resolved.provider == "ollama":
        return OllamaAIProvider(resolved, client=client)
    if resolved.provider == "gemini":
        return GeminiAIProvider(resolved, client=client)
    raise AIConfigurationError(
        f"Unsupported AI provider: {resolved.provider or 'not configured'}."
    )

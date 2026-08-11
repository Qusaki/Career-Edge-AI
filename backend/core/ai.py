from typing import TYPE_CHECKING

# pyrefly: ignore [missing-import]
from fastapi import WebSocket, status

from core.config import resolve_ai_settings
from services.ai_provider import OllamaAIProvider, get_ai_provider, normalize_ollama_base_url

if TYPE_CHECKING:
    # pyrefly: ignore [missing-import]
    from openai import AsyncOpenAI


def get_ollama_base_url() -> str:
    """Compatibility shim for legacy callers during the provider migration."""
    return normalize_ollama_base_url(resolve_ai_settings().base_url)


def get_ollama_client() -> "AsyncOpenAI":
    """Compatibility shim; routers should use the provider-neutral service."""
    provider = get_ai_provider()
    if not isinstance(provider, OllamaAIProvider):
        raise RuntimeError("The legacy Ollama client is unavailable.")
    return provider.client


def get_ollama_model() -> str:
    """Compatibility shim for legacy callers during the provider migration."""
    return resolve_ai_settings().model


def get_ai_unavailable_message() -> str:
    return "The AI service is temporarily unavailable. Please try again."


async def close_ai_unavailable(websocket: WebSocket) -> None:
    try:
        await websocket.send_json(
            {"type": "error", "message": get_ai_unavailable_message()}
        )
        await websocket.close(
            code=status.WS_1011_INTERNAL_ERROR,
            reason="AI interviewer unavailable.",
        )
    except Exception:
        pass

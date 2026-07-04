import os

# pyrefly: ignore [missing-import]
from fastapi import WebSocket, status
# pyrefly: ignore [missing-import]
from openai import AsyncOpenAI


def get_ollama_base_url() -> str:
    """Return an OpenAI-compatible Ollama base URL."""
    base_url = (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434/v1").rstrip("/")
    if base_url.endswith("/v1"):
        return base_url
    return f"{base_url}/v1"


def get_ollama_client() -> AsyncOpenAI:
    return AsyncOpenAI(base_url=get_ollama_base_url(), api_key="ollama")


def get_ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", "llama3.1:8b")


def get_ai_unavailable_message() -> str:
    return (
        "The AI interviewer is unavailable. Make sure Ollama is running "
        "and OLLAMA_BASE_URL points to the Ollama server."
    )


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

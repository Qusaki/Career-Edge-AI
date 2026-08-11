import math
import os
from dataclasses import dataclass
from typing import Mapping

from dotenv import load_dotenv

load_dotenv()


LOCAL_DEVELOPMENT_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def _parse_origins(value: str) -> tuple[str, ...]:
    return tuple(
        origin.strip().rstrip("/")
        for origin in value.split(",")
        if origin.strip()
    )


def _cors_allowed_origins(
    environment: str,
    configured_origins: tuple[str, ...],
) -> tuple[str, ...]:
    origins = configured_origins
    if environment in {"development", "dev", "local"}:
        origins = LOCAL_DEVELOPMENT_ORIGINS + origins

    return tuple(dict.fromkeys(origins))


DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"
DEFAULT_OLLAMA_MODEL = "llama3.1:8b"
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
DEFAULT_AI_TIMEOUT_SECONDS = 180.0


@dataclass(frozen=True)
class AISettings:
    provider: str
    api_key: str
    base_url: str
    model: str
    timeout_seconds: float


def _first_configured_value(
    environment: Mapping[str, str],
    *names: str,
    default: str = "",
) -> str:
    for name in names:
        value = environment.get(name, "").strip()
        if value:
            return value
    return default


def resolve_ai_settings(
    environment: Mapping[str, str] | None = None,
) -> AISettings:
    """Resolve provider-neutral AI settings with legacy Ollama fallbacks."""
    source = os.environ if environment is None else environment
    provider = source.get("AI_PROVIDER", "ollama").strip().lower() or "ollama"

    if provider == "ollama":
        base_url = _first_configured_value(
            source,
            "AI_BASE_URL",
            "OLLAMA_BASE_URL",
            default=DEFAULT_OLLAMA_BASE_URL,
        )
        model = _first_configured_value(
            source,
            "AI_MODEL",
            "OLLAMA_MODEL",
            default=DEFAULT_OLLAMA_MODEL,
        )
        api_key = source.get("AI_API_KEY", "").strip() or "ollama"
    elif provider == "gemini":
        base_url = _first_configured_value(
            source,
            "AI_BASE_URL",
            default=DEFAULT_GEMINI_BASE_URL,
        )
        model = _first_configured_value(
            source,
            "AI_MODEL",
            default=DEFAULT_GEMINI_MODEL,
        )
        api_key = source.get("AI_API_KEY", "").strip()
    else:
        base_url = source.get("AI_BASE_URL", "").strip()
        model = source.get("AI_MODEL", "").strip()
        api_key = source.get("AI_API_KEY", "").strip()

    timeout_value = source.get(
        "AI_TIMEOUT_SECONDS",
        str(DEFAULT_AI_TIMEOUT_SECONDS),
    ).strip()
    try:
        timeout_seconds = float(timeout_value)
    except ValueError as exc:
        raise ValueError("AI_TIMEOUT_SECONDS must be a positive number.") from exc
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("AI_TIMEOUT_SECONDS must be a positive number.")

    return AISettings(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout_seconds,
    )


_ai_settings = resolve_ai_settings()


class Settings:
    PROJECT_NAME: str = "Career Edge AI"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "supersecretkey")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development").strip().lower()
    CORS_ALLOWED_ORIGINS: tuple[str, ...] = _cors_allowed_origins(
        ENVIRONMENT,
        _parse_origins(os.getenv("CORS_ALLOWED_ORIGINS", "")),
    )
    AI_PROVIDER: str = _ai_settings.provider
    AI_API_KEY: str = _ai_settings.api_key
    AI_BASE_URL: str = _ai_settings.base_url
    AI_MODEL: str = _ai_settings.model
    AI_TIMEOUT_SECONDS: float = _ai_settings.timeout_seconds


settings = Settings()

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from services.ai_provider import AIProvider, AIProviderUnavailableError


async def collect_ai_response(
    provider: AIProvider,
    messages: Sequence[Mapping[str, str]],
    *,
    workload: str,
) -> str:
    """Collect one provider-neutral streamed response for non-streaming callers."""
    response = "".join(
        [chunk async for chunk in provider.stream_chat(messages, workload=workload)]
    ).strip()
    if not response:
        raise AIProviderUnavailableError("The AI service returned an empty response.")
    return response


def parse_evaluation_response(
    response: str,
    required_score_keys: Sequence[str],
) -> dict[str, Any]:
    """Parse and structurally validate an AI rubric response without trusting scores."""
    normalized = response.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", normalized, re.DOTALL | re.IGNORECASE)
    if fenced:
        normalized = fenced.group(1).strip()

    try:
        evaluation = json.loads(normalized)
    except json.JSONDecodeError as error:
        raise ValueError("The AI evaluation was not valid JSON.") from error

    if not isinstance(evaluation, dict):
        raise ValueError("The AI evaluation must be a JSON object.")

    missing = [key for key in required_score_keys if key not in evaluation]
    if missing:
        raise ValueError("The AI evaluation omitted required rubric scores.")

    for key in required_score_keys:
        value = evaluation[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("The AI evaluation contained a non-numeric rubric score.")

    feedback = evaluation.get("feedback_summary")
    if not isinstance(feedback, str) or not feedback.strip():
        raise ValueError("The AI evaluation omitted feedback.")

    return evaluation


def transcript_text(messages: Sequence[Any]) -> str:
    """Render stored or request-schema conversation items for an evaluation prompt."""
    lines: list[str] = []
    for message in messages:
        role = getattr(message, "role", None) or getattr(message, "sender", "")
        content = getattr(message, "content", None) or getattr(message, "text", "")
        normalized_role = "PROFESSOR" if str(role).lower() in {"ai", "assistant"} else "STUDENT"
        if str(content).strip():
            lines.append(f"{normalized_role}: {str(content).strip()}")
    return "\n".join(lines)

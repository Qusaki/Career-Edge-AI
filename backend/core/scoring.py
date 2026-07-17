import math
from typing import Any, Mapping


def bounded_score(
    evaluation: Mapping[str, Any],
    key: str,
    *,
    minimum: float,
    maximum: float,
    default: float,
) -> float:
    """Coerce and clamp an externally supplied score to its rubric range."""
    raw_value = evaluation.get(key, default)
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        value = default
    if not math.isfinite(value):
        value = default
    return round(min(maximum, max(minimum, value)), 2)


def bounded_integer_score(
    evaluation: Mapping[str, Any],
    key: str,
    *,
    minimum: int,
    maximum: int,
    default: int,
) -> int:
    return int(round(bounded_score(
        evaluation,
        key,
        minimum=minimum,
        maximum=maximum,
        default=default,
    )))

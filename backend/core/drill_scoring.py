import re
from typing import Any, Dict, Tuple


DRILL_WORD_THRESHOLDS: Dict[str, Tuple[int, int]] = {
    "jam": (30, 60),
    "fast_word": (4, 8),
    "emotion": (2, 4),
    "synonym": (2, 3),
    "fake_profile": (15, 30),
    "emoji_story": (15, 30),
    "taboo": (15, 30),
    "elevator_pitch": (20, 40),
    "rephrase": (8, 15),
    "positive_framing": (8, 15),
    "crisis": (25, 50),
}


def _word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?", text))


def _get_response_measure(drill_type: str, evaluation_data: Dict[str, Any]) -> Tuple[str, int, str]:
    if drill_type == "negotiation":
        messages = evaluation_data.get("negotiation_messages") or []
        user_messages = [
            str(message.get("text", "")).strip()
            for message in messages
            if isinstance(message, dict) and message.get("sender") == "user" and str(message.get("text", "")).strip()
        ]
        return " ".join(user_messages), len(user_messages), "user_turns"

    response = str(evaluation_data.get("spoken_response") or "").strip()
    return response, _word_count(response), "spoken_words"


def calculate_drill_score(drill_type: str, evaluation_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate a Drill score using the same 30-point structure as Post-Test."""
    response, measured_value, measurement = _get_response_measure(drill_type, evaluation_data)
    if not response:
        raise ValueError("A spoken response is required before this Drill can be scored.")

    if drill_type == "negotiation":
        developing_threshold, proficient_threshold = 3, 5
    else:
        developing_threshold, proficient_threshold = DRILL_WORD_THRESHOLDS.get(drill_type, (15, 30))

    # This mirrors the current Active Listening and Post-Test calculation:
    # proficient=4, developing=3, beginning=2 for response-based criteria.
    base_score = 4 if measured_value >= proficient_threshold else 3 if measured_value >= developing_threshold else 2
    criteria = {
        "vocabulary": base_score,
        "clarity": base_score,
        "grammar": base_score,
        "conciseness": base_score,
        "task_completion": 3,
        "courtesy": 4,
    }
    raw_score = sum(criteria.values())
    percentage = round((raw_score / 30) * 100, 2)
    passed = raw_score >= 20

    if passed:
        feedback = (
            f"Drill completed successfully with {measured_value} {measurement.replace('_', ' ')}. "
            "The response met the expected participation threshold."
        )
    else:
        feedback = (
            f"Drill completed with {measured_value} {measurement.replace('_', ' ')}. "
            f"Aim for at least {proficient_threshold} {measurement.replace('_', ' ')} to meet the proficiency threshold."
        )

    return {
        "score": percentage,
        "passed": passed,
        "feedback_summary": feedback,
        "scoring": {
            "rubric_version": "drill-communication-v1",
            "measurement": measurement,
            "measured_value": measured_value,
            "developing_threshold": developing_threshold,
            "proficient_threshold": proficient_threshold,
            "criteria": criteria,
            "raw_score": raw_score,
            "max_score": 30,
            "passing_score": 20,
            "percentage": percentage,
        },
    }

"""Conservative, content-based ceilings for response rubrics.

These checks do not pretend to measure pronunciation or semantic equivalence.
They only prevent objectively sparse or repeated text from receiving top marks.
"""

import re
import math
from collections import Counter


_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "had", "has",
    "have", "i", "in", "is", "it", "my", "of", "on", "or", "our", "that", "the",
    "their", "them", "there", "these", "they", "this", "to", "was", "were", "will",
    "with", "you", "your", "summarize", "please", "listen", "carefully",
}


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower())


def repetition_dominated(text: str) -> bool:
    tokens = words(text)
    if len(tokens) < 12:
        return False
    trigrams = [tuple(tokens[index:index + 3]) for index in range(len(tokens) - 2)]
    return (
        len(set(tokens)) / len(tokens) < 0.28
        or len(set(trigrams)) / len(trigrams) < 0.45
        or Counter(trigrams).most_common(1)[0][1] >= max(4, len(trigrams) // 4)
    )


def intro_quality_cap(text: str) -> tuple[int | None, str | None]:
    tokens = words(text)
    if repetition_dominated(text):
        return 1, "The introduction repeated the same material instead of developing the requested details."
    normalized = text.lower()
    requested_details = (
        bool(re.search(r"\b(my name|i am|i'm|call me)\b", normalized)),
        bool(re.search(r"\b(course|department|major|studying|study|student|degree)\b", normalized)),
        bool(re.search(r"\b(interest|enjoy|passion|like|focus)\b", normalized)),
        bool(re.search(r"\b(strength|skill|good at|able to|experience)\b", normalized)),
        bool(re.search(r"\b(interview|career|job|goal|prepare|future)\b", normalized)),
    )
    if len(tokens) < 12 or sum(requested_details) <= 1:
        return 1, "The introduction did not cover enough of the requested personal, academic, and career details."
    if sum(requested_details) <= 3 or len(tokens) < 25:
        return 2, "The introduction should add more of the requested details about studies, interests, strengths, and goals."
    return None, None


def listening_quality_cap(story: str, answer: str) -> tuple[int | None, str | None]:
    if repetition_dominated(answer):
        return 2, "The summary repeated fragments instead of accurately covering the listening story."
    answer_tokens = words(answer)
    if len(answer_tokens) < 10:
        return 2, "The summary omitted most of the listening story's required details."
    story_terms = {token for token in words(story) if len(token) > 2 and token not in _STOP_WORDS}
    answer_terms = set(answer_tokens)
    coverage = len(story_terms & answer_terms) / max(1, len(story_terms))
    if coverage < 0.12:
        return 2, "The summary omitted most of the listening story's concrete details."
    if coverage < 0.22:
        return 3, "The summary covered only some of the listening story's concrete details."
    return None, None


def post_test_quality_cap(answers: list[str]) -> tuple[int | None, str | None]:
    nonempty = [answer.strip() for answer in answers if answer.strip()]
    if len(nonempty) < 5:
        return 2, "Not all five interview questions received substantive answers."
    if repetition_dominated(" ".join(nonempty)) or len({answer.lower() for answer in nonempty}) <= 2:
        return 2, "The interview repeated answers instead of addressing each question distinctly."
    if sum(len(words(answer)) < 8 for answer in nonempty) >= 3:
        return 3, "Several interview answers lacked enough detail to address their questions."
    return None, None


def cap_rubric(evaluation: dict, keys: tuple[str, ...], cap: int | None, reason: str | None) -> dict:
    if cap is None:
        return evaluation
    adjusted = dict(evaluation)
    for key in keys:
        if key in adjusted:
            try:
                adjusted[key] = min(cap, float(adjusted[key]))
            except (TypeError, ValueError):
                adjusted[key] = 1
    adjusted["feedback_summary"] = reason or "The response did not meet the full rubric requirements."
    return adjusted


def validate_five_point_scores(evaluation: dict, keys: tuple[str, ...]) -> None:
    if any(
        isinstance(evaluation.get(key), bool)
        or not isinstance(evaluation.get(key), (int, float))
        or not math.isfinite(evaluation[key])
        or not 1 <= evaluation[key] <= 5
        for key in keys
    ):
        raise ValueError("The AI evaluation contained an invalid or out-of-range rubric score.")

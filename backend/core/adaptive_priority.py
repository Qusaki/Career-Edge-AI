"""Pure, deterministic Adaptive Practice recommendation policy."""

from dataclasses import dataclass
from datetime import datetime
import math
from typing import Literal


Criterion = Literal["vocabulary", "clarity", "grammar", "conciseness", "courtesy"]
Difficulty = Literal["beginner", "intermediate", "advanced"]
Family = Literal["pre_test", "drill", "post_test", "adaptive"]
CRITERIA: tuple[Criterion, ...] = ("vocabulary", "clarity", "grammar", "conciseness", "courtesy")
TIE_ORDER: tuple[Criterion, ...] = ("clarity", "conciseness", "vocabulary", "grammar", "courtesy")
DIFFICULTIES: tuple[Difficulty, ...] = ("beginner", "intermediate", "advanced")
SEMANTIC_AUTHORITY = "semantic_ai_with_objective_caps"


@dataclass(frozen=True)
class Evidence:
    family: Family
    id: int
    completed_at: datetime
    scores: dict[str, float]
    subtype: str = ""
    target: str = ""
    difficulty: str = ""


def _valid_score(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 1 <= value <= 5


def _recent(items: list[Evidence], limit: int) -> list[Evidence]:
    return sorted(items, key=lambda item: (item.completed_at, item.id), reverse=True)[:limit]


def _mean(items: list[Evidence], criterion: Criterion, weights: tuple[int, ...]) -> float | None:
    values = [(item.scores.get(criterion), weight) for item, weight in zip(items, weights)]
    valid = [(value, weight) for value, weight in values if _valid_score(value)]
    return sum(value * weight for value, weight in valid) / sum(weight for _, weight in valid) if valid else None


def _level(score: float) -> Difficulty:
    return "beginner" if score < 3 else "intermediate" if score < 4 else "advanced"


def select_adaptive_priority(evidence: list[Evidence]) -> dict:
    """Select from already verified, completed semantic evidence; never call AI."""
    pre = [item for item in evidence if item.family == "pre_test"]
    drills = _recent([item for item in evidence if item.family == "drill"], 3)
    post = _recent([item for item in evidence if item.family == "post_test"], 1)
    adaptive = _recent([item for item in evidence if item.family == "adaptive"], len(evidence))
    initial_pre = []
    for subtype in ("who_am_i", "active_listening"):
        matching = sorted((item for item in pre if item.subtype == subtype), key=lambda item: (item.completed_at, item.id))
        if matching:
            initial_pre.append(matching[0])
    pre_cutoff = max((item.completed_at for item in initial_pre), default=None)
    later_results = [item for item in evidence if item.family in ("drill", "post_test")
                     and pre_cutoff is not None and item.completed_at > pre_cutoff]
    pre_weight = 0 if len(later_results) >= 3 else 1
    scores: dict[str, float] = {}
    source_summary: dict[str, list[str]] = {}
    for criterion in CRITERIA:
        families: list[tuple[str, float, int]] = []
        if pre_weight:
            value = _mean(initial_pre, criterion, (1, 1))
            if value is not None:
                families.append(("Pre-Test", value, pre_weight))
        for name, rows, recency, weight in (("Drills", drills, (3, 2, 1), 2), ("Post-Test", post, (1,), 2)):
            value = _mean(rows, criterion, recency)
            if value is not None:
                families.append((name, value, weight))
        adaptive_for_criterion = [item for item in adaptive if _valid_score(item.scores.get(criterion))][:3]
        value = _mean(adaptive_for_criterion, criterion, (3, 2, 1))
        if value is not None:
            families.append(("Adaptive Practice", value, 1))
        if families:
            scores[criterion] = round(sum(value * weight for _, value, weight in families) / sum(weight for _, _, weight in families), 3)
            source_summary[criterion] = [name for name, _, _ in families]
    if not scores:
        return {"scores": {}, "priority_criterion": None, "difficulty": None, "confidence": "none",
                "source_summary": {}, "reason": "Complete an assessment to get a personalized recommendation.",
                "maintenance": False}
    ranked = sorted(scores, key=lambda key: (scores[key], TIE_ORDER.index(key)))
    priority = ranked[0]
    latest_adaptive = adaptive[0] if adaptive else None
    current = latest_adaptive.target if latest_adaptive and latest_adaptive.target in scores else None
    if current and current != priority and scores[current] - scores[priority] < 0.5:
        latest_target = [item for item in adaptive if item.target == current][:2]
        strong = len(latest_target) == 2 and all(_valid_score(item.scores.get(current)) and item.scores[current] >= 4 for item in latest_target)
        if not strong:
            priority = current
    difficulty = _level(scores[priority])
    if latest_adaptive and latest_adaptive.target == priority and latest_adaptive.difficulty in DIFFICULTIES:
        difficulty = latest_adaptive.difficulty
        same_level = adaptive[:2]
        if len(same_level) == 2 and all(item.target == priority and item.difficulty == difficulty and _valid_score(item.scores.get(priority)) for item in same_level):
            index = DIFFICULTIES.index(difficulty)
            if all(item.scores[priority] >= 4 for item in same_level):
                difficulty = DIFFICULTIES[min(index + 1, 2)]
            elif all(item.scores[priority] < 3 for item in same_level):
                difficulty = DIFFICULTIES[max(index - 1, 0)]
    maintenance = len(scores) == len(CRITERIA) and all(value >= 4 for value in scores.values())
    count = len(initial_pre) + len(drills) + len(post) + len(adaptive)
    confidence = "supported" if count >= 3 else "limited"
    label = priority.replace("_", " ").title()
    reason = (f"Maintenance Focus: {label} is your lowest current communication area in the strong range."
              if maintenance else f"{label} is currently one of your lower-scoring communication areas based on your completed activities.")
    if confidence == "limited":
        reason += " Based on your available completed assessment."
    return {"scores": scores, "priority_criterion": priority, "difficulty": difficulty,
            "confidence": confidence, "source_summary": source_summary, "reason": reason, "maintenance": maintenance}

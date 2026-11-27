"""Verified evidence selection and one-call, privacy-minimized practice generation."""

import hashlib
import json
import logging
import math
import re
from typing import Any

from sqlalchemy.orm import Session

from core.adaptive_priority import CRITERIA, SEMANTIC_AUTHORITY, Evidence, select_adaptive_priority
from core.drill_progression import DRILL_LEVEL_BY_TYPE
from models.adaptive_practice import AdaptivePracticeSession
from models.drills import DrillSession
from models.post_test_interview import PostTestInterviewSession
from models.pre_test_active_listening import PreTestActiveListeningSession
from models.pre_test_intro import PreTestIntroSession
from services.ai_provider import AIProvider, get_ai_provider
from services.interview_ai import collect_ai_response


logger = logging.getLogger(__name__)
GENERATION_VERSION = "adaptive-generation-v1"
EVALUATION_VERSION = "adaptive-evaluation-v1"
CATEGORIES = ("explaining", "responding", "summarizing", "planning")
DEPARTMENT_CONTEXTS = {
    "CCIT": ("software project", "technical support request"),
    "CTE": ("classroom activity", "learner support request"),
    "CBAPA": ("business service", "administrative request"),
    None: ("group project", "professional request"),
}
DEPARTMENT_TERMS = {
    "CCIT": ("software", "app", "system", "technical", "technology", "database", "digital"),
    "CTE": ("classroom", "learner", "student", "lesson", "teaching", "education", "school"),
    "CBAPA": ("business", "service", "customer", "administrative", "management", "budget", "office"),
}
FOCUS_TASKS = {
    "vocabulary": "Choose precise words suitable for your audience",
    "clarity": "State your main point clearly before adding support",
    "grammar": "Use clear, well-formed sentences",
    "conciseness": "Give a focused answer without repeated ideas",
    "courtesy": "Respond respectfully and professionally",
}
FOCUS_TERMS = {
    "vocabulary": ("word", "precise", "specific", "terminology", "describe"),
    "clarity": ("clear", "explain", "organize", "main point", "structure"),
    "grammar": ("sentence", "grammar", "phrasing", "well-formed"),
    "conciseness": ("brief", "concise", "short", "focused", "summarize"),
    "courtesy": ("respect", "polite", "professional", "courteous"),
}
DIFFICULTY_TASKS = {
    "beginner": "in two or three connected sentences",
    "intermediate": "with a main point and one supporting detail",
    "advanced": "while addressing a constraint and giving a practical next step",
}


def _score(value: object, maximum: int = 5) -> float | None:
    return float(value) if type(value) in (int, float) and math.isfinite(value) and 1 <= value <= maximum and math.isclose(round(value * 10), value * 10, abs_tol=1e-9) else None


def _semantic_completed(row: Any) -> bool:
    return row.status == "completed" and row.end_time is not None and row.scoring_authority == SEMANTIC_AUTHORITY


def _drill_evidence(row: DrillSession) -> Evidence | None:
    if row.status != "completed" or row.end_time is None or row.drill_type not in DRILL_LEVEL_BY_TYPE or row.score is None or not 0 <= row.score <= 100:
        return None
    try:
        data = json.loads(row.evaluation_data or "")
        scoring = data["scoring"]
        if scoring.get("authority") != SEMANTIC_AUTHORITY or scoring.get("rubric_version") != "drill-hybrid-v1":
            return None
        all_scores = [_score(scoring["criteria"].get(key)) for key in (*CRITERIA, "task_completion")]
        if any(value is None for value in all_scores) or not math.isclose(sum(all_scores), scoring.get("raw_score", -1), abs_tol=0.01):
            return None
        if not math.isclose(row.score, sum(all_scores) / 30 * 100, abs_tol=0.02):
            return None
        scores = dict(zip((*CRITERIA, "task_completion"), all_scores))
        return Evidence("drill", row.id, row.end_time, scores)
    except (ValueError, TypeError, KeyError, AttributeError):
        return None


def _post_evidence(row: PostTestInterviewSession) -> Evidence | None:
    if row.status != "completed" or row.end_time is None or not isinstance(row.evaluation_data, dict):
        return None
    data = row.evaluation_data
    if data.get("scoring_authority") != SEMANTIC_AUTHORITY or data.get("schema_version") != "post-test-evaluation-v2":
        return None
    aggregate = data.get("aggregate_criteria")
    if not isinstance(aggregate, dict):
        return None
    scores = {key: _score(aggregate.get(key)) for key in CRITERIA}
    if any(value is None for value in scores.values()) or data.get("total_score") != sum(scores.values()):
        return None
    return Evidence("post_test", row.id, row.end_time, scores)


def _pre_evidence(row: Any, subtype: str) -> Evidence | None:
    if not _semantic_completed(row):
        return None
    scores = {}
    for key in CRITERIA:
        maximum = 3 if subtype == "who_am_i" and key in {"clarity", "courtesy", "conciseness"} else 5
        native = _score(getattr(row, f"score_{key}", None), maximum)
        if native is not None:
            scores[key] = native / maximum * 5 if maximum == 3 else native
    return Evidence("pre_test", row.id, row.end_time, scores, subtype=subtype) if scores else None


def _adaptive_evidence(row: AdaptivePracticeSession) -> Evidence | None:
    if row.status != "completed" or row.completed_at is None or row.scoring_authority != SEMANTIC_AUTHORITY or row.target_criterion not in CRITERIA:
        return None
    scores = {key: _score(getattr(row, f"score_{key}", None)) for key in CRITERIA}
    task_score = _score(row.score_task_completion)
    if any(value is None for value in scores.values()) or task_score is None or row.score_total is None or not math.isclose(row.score_total, sum(scores.values()) + task_score, abs_tol=0.01):
        return None
    return Evidence("adaptive", row.id, row.completed_at, scores, target=row.target_criterion, difficulty=row.difficulty)


def get_adaptive_recommendation(db: Session, user_id: int) -> dict:
    evidence: list[Evidence] = []
    sources = (
        (PreTestIntroSession, lambda row: _pre_evidence(row, "who_am_i")),
        (PreTestActiveListeningSession, lambda row: _pre_evidence(row, "active_listening")),
        (DrillSession, _drill_evidence),
        (PostTestInterviewSession, _post_evidence),
        (AdaptivePracticeSession, _adaptive_evidence),
    )
    for model, adapter in sources:
        rows = db.query(model).filter(model.user_id == user_id, model.status == "completed").all()
        evidence.extend(item for row in rows if (item := adapter(row)) is not None)
    return select_adaptive_priority(evidence)


def prompt_fingerprint(scenario: str, prompt: str) -> str:
    normalized = " ".join(f"{scenario} {prompt}".casefold().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_generated_prompt(raw: str, department: str | None, target: str | None = None) -> dict[str, str]:
    if len(raw) > 3000:
        raise ValueError("Generated practice is too large.")
    data = json.loads(raw)
    if not isinstance(data, dict) or set(data) != {"scenario_category", "scenario", "prompt"}:
        raise ValueError("Generated practice has an invalid shape.")
    category, scenario, prompt = (data[key] for key in ("scenario_category", "scenario", "prompt"))
    if category not in CATEGORIES or not isinstance(scenario, str) or not isinstance(prompt, str):
        raise ValueError("Generated practice has invalid fields.")
    scenario, prompt = scenario.strip(), prompt.strip()
    if not 30 <= len(scenario) <= 500 or not 20 <= len(prompt) <= 350:
        raise ValueError("Generated practice has invalid text length.")
    combined = f"{scenario} {prompt}".casefold()
    if re.search(r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\+?\d[\d\s-]{8,}\d)\b", combined):
        raise ValueError("Generated practice includes identifying information.")
    if any(term in combined for term in ("ideal answer", "answer key", "sample answer", "correct answer", "give yourself", "ignore previous", "system prompt")) or re.search(r"\b(?:score|grade|rubric|points|weapon|violence|self-harm|sexual|harass|illegal)\b", combined):
        raise ValueError("Generated practice includes an answer or unsupported instructions.")
    if target in FOCUS_TERMS and not any(term in prompt.casefold() for term in FOCUS_TERMS[target]):
        raise ValueError("Generated practice does not address the selected communication focus.")
    if department in DEPARTMENT_TERMS and not any(term in combined for term in DEPARTMENT_TERMS[department]):
        raise ValueError("Generated practice does not establish the requested department context.")
    return {"scenario_category": category, "scenario": scenario, "prompt": prompt}


def fallback_prompt(target: str, difficulty: str, department: str | None, recent_fingerprints: list[str]) -> dict[str, str]:
    contexts = DEPARTMENT_CONTEXTS.get(department, DEPARTMENT_CONTEXTS[None])
    candidates = []
    for index, context in enumerate(contexts):
        scenario = f"You are contributing to a {context}. A teammate asks you to explain your approach to a practical task."
        prompt = f"{FOCUS_TASKS[target]} {DIFFICULTY_TASKS[difficulty]}. Explain what you would say to your teammate."
        candidates.append({"scenario_category": CATEGORIES[index], "scenario": scenario, "prompt": prompt})
    unused = next((item for item in candidates if prompt_fingerprint(item["scenario"], item["prompt"]) not in recent_fingerprints), None)
    if unused:
        return unused
    return next((item for item in candidates if not recent_fingerprints or prompt_fingerprint(item["scenario"], item["prompt"]) != recent_fingerprints[0]), candidates[0])


async def generate_adaptive_prompt(
    target: str, difficulty: str, department: str | None, target_score: float,
    recent_categories: list[str], recent_fingerprints: list[str], provider: AIProvider | None = None,
) -> tuple[dict[str, str], str]:
    """One provider request at most; validated failure uses the local bank."""
    system = (
        "Create ONE safe, realistic academic or professional speaking practice scenario. "
        f"Instructional focus: {target}. Difficulty: {difficulty}. Department: {department or 'neutral'}. "
        "Do not write an ideal answer, answer key, rubric, score, personal name, email, or private information. "
        "Do not change the focus or difficulty. Return ONLY JSON with exactly scenario_category "
        "(explaining/responding/summarizing/planning), scenario (30-500 chars), prompt (20-350 chars)."
    )
    context = {"target_score_out_of_5": round(target_score, 2), "recent_categories": recent_categories[:5]}
    try:
        raw = await collect_ai_response(provider or get_ai_provider(), [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(context)},
        ], workload="adaptive_practice_generation")
        generated = validate_generated_prompt(raw, department, target)
        if prompt_fingerprint(generated["scenario"], generated["prompt"]) in recent_fingerprints:
            raise ValueError("Generated practice repeated a recent prompt.")
        return generated, "ai_generated"
    except Exception as error:
        logger.warning("Adaptive practice generation used fallback: %s", type(error).__name__)
        return fallback_prompt(target, difficulty, department, recent_fingerprints), "deterministic_fallback"

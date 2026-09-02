from typing import TypedDict

from sqlalchemy.orm import Session

from models.drills import DrillSession


DRILL_TYPES_BY_LEVEL: dict[str, tuple[str, ...]] = {
    "easy": ("jam", "fast_word"),
    "medium": ("emotion", "synonym", "fake_profile", "emoji_story", "positive_framing"),
    "hard": ("taboo", "elevator_pitch", "rephrase", "negotiation", "crisis"),
}

DRILL_LEVEL_BY_TYPE: dict[str, str] = {
    drill_type: level
    for level, drill_types in DRILL_TYPES_BY_LEVEL.items()
    for drill_type in drill_types
}

DRILL_LEVEL_PREREQUISITES: dict[str, str] = {
    "medium": "easy",
    "hard": "medium",
}

DRILL_UNLOCK_NAMES: dict[str, str] = {
    "jam": "JAM",
    "fast_word": "Fast Word",
    "emotion": "Emotion",
    "synonym": "Synonym",
    "fake_profile": "Fake Profile",
    "emoji_story": "Emoji Story",
    "positive_framing": "Positive Framing",
    "taboo": "Taboo",
    "elevator_pitch": "Elevator Pitch",
    "rephrase": "Rephrase",
    "negotiation": "Salary Negotiation",
    "crisis": "Crisis Response",
}


class DrillLevelProgressData(TypedDict):
    unlocked: bool
    completed: int
    total: int
    completed_types: list[str]
    drills: list["DrillTypeProgressData"]


class DrillTypeProgressData(TypedDict):
    type: str
    completed: bool
    unlocked: bool
    prerequisite_type: str | None


def get_completed_drill_types(db: Session, user_id: int) -> set[str]:
    rows = (
        db.query(DrillSession.drill_type)
        .filter(
            DrillSession.user_id == user_id,
            DrillSession.status == "completed",
        )
        .distinct()
        .all()
    )
    return {
        drill_type
        for (drill_type,) in rows
        if drill_type in DRILL_LEVEL_BY_TYPE
    }


def is_drill_level_unlocked(
    drill_level: str,
    completed_types: set[str],
) -> bool:
    if drill_level == "easy":
        return True
    prerequisite = DRILL_LEVEL_PREREQUISITES.get(drill_level)
    if prerequisite is None:
        return False
    return set(DRILL_TYPES_BY_LEVEL[prerequisite]).issubset(completed_types)


def get_previous_drill_type(drill_type: str) -> str | None:
    level = DRILL_LEVEL_BY_TYPE.get(drill_type)
    if level is None:
        return None
    ordered_types = DRILL_TYPES_BY_LEVEL[level]
    position = ordered_types.index(drill_type)
    return ordered_types[position - 1] if position > 0 else None


def is_drill_type_unlocked(
    drill_type: str,
    completed_types: set[str],
) -> bool:
    level = DRILL_LEVEL_BY_TYPE.get(drill_type)
    if level is None:
        return False
    if drill_type in completed_types:
        return True
    if not is_drill_level_unlocked(level, completed_types):
        return False
    previous_type = get_previous_drill_type(drill_type)
    return previous_type is None or previous_type in completed_types


def build_drill_progress(db: Session, user_id: int) -> dict[str, DrillLevelProgressData]:
    completed_types = get_completed_drill_types(db, user_id)
    progress: dict[str, DrillLevelProgressData] = {}
    for level, required_types in DRILL_TYPES_BY_LEVEL.items():
        completed_for_level = [
            drill_type for drill_type in required_types if drill_type in completed_types
        ]
        progress[level] = {
            "unlocked": is_drill_level_unlocked(level, completed_types),
            "completed": len(completed_for_level),
            "total": len(required_types),
            "completed_types": completed_for_level,
            "drills": [
                {
                    "type": drill_type,
                    "completed": drill_type in completed_types,
                    "unlocked": is_drill_type_unlocked(drill_type, completed_types),
                    "prerequisite_type": get_previous_drill_type(drill_type),
                }
                for drill_type in required_types
            ],
        }
    return progress


def get_drill_lock_message(drill_level: str) -> str:
    prerequisite = DRILL_LEVEL_PREREQUISITES.get(drill_level)
    if prerequisite is None:
        return "This Drill level is not available."
    return f"Complete all {prerequisite.title()} drills before unlocking {drill_level.title()}."


def get_drill_type_lock_message(drill_type: str) -> str:
    previous_type = get_previous_drill_type(drill_type)
    if previous_type is None:
        return "This Drill is not available yet."
    return f"Complete {DRILL_UNLOCK_NAMES[previous_type]} first to unlock."

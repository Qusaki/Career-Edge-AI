"""Mirror versioned Drill prompt selection for authoritative sync scoring."""

from typing import Any


POOLS: dict[str, list[Any]] = {
    "jam": ["Coffee", "Smartphones", "The Future of AI", "My Favorite Book", "Why Sleep is Important", "Traveling", "The Ocean", "Social Media"],
    "fast_word": ["Database", "Cloud", "Network", "Algorithm", "Security", "Frontend", "Backend", "Python", "Server"],
    "emotion_sentences": ["The food is here.", "I can't believe this is happening.", "Look at what you've done.", "It's time to go home.", "Are you sure about that?"],
    "emotions": ["Angry", "Excited", "Sad", "Confused", "Nervous", "Joyful"],
    "synonym": ["Good", "Fast", "Big", "Small", "Happy", "Sad", "Hard", "Easy"],
    "names": ["Alex", "Jordan", "Taylor", "Casey", "Morgan", "Riley"],
    "ages": [22, 28, 35, 41, 19, 50],
    "jobs": ["Astronaut", "Chef", "Software Engineer", "Teacher", "Pilot", "Artist"],
    "hobbies": ["Cooking", "Skydiving", "Reading", "Gaming", "Gardening", "Photography"],
    "emojis": ["🚀", "🍕", "🐱", "🎸", "⛰️", "📱", "🎈", "👻", "🌮", "🐉"],
    "taboo": [
        {"topic": "How to cook rice", "banned_words": ["Rice", "Water", "Cooker", "Eat"]},
        {"topic": "How to ride a bike", "banned_words": ["Pedal", "Wheels", "Balance", "Ride"]},
        {"topic": "Explain what a database is", "banned_words": ["Data", "Store", "SQL", "Table"]},
        {"topic": "How to make a sandwich", "banned_words": ["Bread", "Meat", "Eat", "Cheese"]},
    ],
    "elevator_pitch": [
        "Pitch your app idea to a billionaire in an elevator.",
        "Pitch yourself for your dream job to the CEO in 30 seconds.",
        "Convince a busy investor why your startup will change the world.",
        "Pitch your thesis topic to a skeptical professor.",
    ],
    "rephrase": [
        "In the event of an unforeseen exigency, it is imperative that personnel evacuate the premises expeditiously using the designated egress routes to ensure maximal survivability.",
        "The utilization of heterogeneous data structures facilitates the optimization of algorithmic complexity, thereby ameliorating the latency inherent in synchronous processing paradigms.",
        "Notwithstanding the aforementioned stipulations, the contractual obligations remain binding in perpetuity unless mutually abrogated by all signatory parties involved in the agreement.",
    ],
    "positive_framing": [
        "Your app is slow, full of bugs, and completely ruined my project!",
        "I have been waiting on hold for an hour, your customer service is terrible and incompetent.",
        "The product arrived broken and it's cheaply made. I demand a refund right now.",
        "You completely ignored my email and missed the deadline, you are highly unprofessional.",
    ],
    "crisis_scenarios": [
        "Your system got hacked and user data leaked!",
        "A critical bug caused your company's main app to crash globally for 24 hours.",
        "Your new product launch caught on fire during a live demonstration.",
        "A top executive was caught embezzling funds from the charity division.",
    ],
    "crisis_questions": [
        "Why did you hide this from the public?!",
        "Who is taking responsibility for this disaster?",
        "What are you doing to fix this right now?",
        "Are you going to resign over this?",
        "How can users ever trust you again?",
        "Is it true you knew about this for weeks?",
    ],
}

# drills-v1 above is immutable: saved offline checkpoints must continue to
# reproduce their original prompts during resume and synchronization.
V2_FIELD_POOLS: dict[str, dict[str, list[Any]]] = {
    "fast_word": {
        "CCIT": ["Database", "Cloud", "Network", "Algorithm", "Security", "Frontend", "Backend", "Python", "Server"],
        "CTE": ["Classroom", "Curriculum", "Lesson", "Assessment", "Learner", "Pedagogy", "Instruction", "Learning Objective", "Classroom Management"],
        "CBAPA": ["Marketing", "Budgeting", "Management", "Customer", "Leadership", "Accounting", "Operations", "Strategy", "Public Service"],
    },
    "fake_profile_jobs": {
        "CCIT": ["Software Engineer", "Web Developer", "IT Support Specialist", "Systems Analyst", "Data Analyst"],
        "CTE": ["Teacher", "Training Facilitator", "Learning Support Specialist", "Education Coordinator", "Classroom Adviser"],
        "CBAPA": ["Marketing Associate", "Administrative Officer", "Business Analyst", "HR Associate", "Operations Coordinator"],
    },
    "taboo": {
        "CCIT": [{"topic": "Explain what a database is", "banned_words": ["Data", "Store", "SQL", "Table"]}],
        "CTE": [{"topic": "Explain what a lesson plan is", "banned_words": ["Teacher", "Class", "Topic", "Prepare"]}],
        "CBAPA": [{"topic": "Explain what a budget is", "banned_words": ["Money", "Spend", "Cost", "Plan"]}],
    },
    "elevator_pitch": {
        "CCIT": ["Pitch a useful student app to a school administrator in an elevator."],
        "CTE": ["Pitch a simple learning activity to a school administrator in an elevator."],
        "CBAPA": ["Pitch an improved customer service process to a manager in an elevator."],
    },
    "rephrase": {
        "CCIT": ["The utilization of heterogeneous data structures facilitates the optimization of algorithmic complexity, thereby ameliorating the latency inherent in synchronous processing paradigms."],
        "CTE": ["The implementation of differentiated instructional strategies facilitates the accommodation of diverse learning needs, thereby improving participation during classroom activities."],
        "CBAPA": ["The implementation of coordinated administrative procedures facilitates the allocation of available resources, thereby improving the efficiency of routine service operations."],
    },
    "positive_framing": {
        "CCIT": ["Your app is slow, full of bugs, and completely ruined my project!"],
        "CTE": ["The lesson was confusing, and I still don't understand what I was supposed to learn!"],
        "CBAPA": ["Your service process is slow, and I have had to repeat my request several times!"],
    },
    "crisis_scenarios": {
        "CCIT": ["A critical bug caused your company's main app to crash globally for 24 hours."],
        "CTE": ["A classroom activity was disrupted because the prepared learning materials were unavailable."],
        "CBAPA": ["A service interruption left several customers waiting without a clear update."],
    },
}

V2_SHARED_POOLS: dict[str, list[Any]] = {
    "taboo": [POOLS["taboo"][0], POOLS["taboo"][1], POOLS["taboo"][3]],
    "elevator_pitch": [POOLS["elevator_pitch"][1], POOLS["elevator_pitch"][3]],
    "rephrase": [POOLS["rephrase"][0]],
    "positive_framing": [POOLS["positive_framing"][1], POOLS["positive_framing"][2], POOLS["positive_framing"][3]],
    "crisis_scenarios": ["A scheduled community event was disrupted by a sudden venue closure."],
}


class InvalidDrillDepartmentError(ValueError):
    pass


def normalize_drill_department(department: str | None) -> str | None:
    normalized = (department or "").strip().upper()
    return normalized if normalized in {"CCIT", "CTE", "CBAPA"} else None

LABELS = {
    "topic": "Topic", "word": "Target word", "sentence": "Sentence", "emotion": "Target emotion",
    "name": "Name", "age": "Age", "job": "Job", "hobby": "Hobby", "emojis": "Emojis",
    "complaint": "Situation", "banned_words": "Forbidden words", "scenario": "Scenario",
    "instruction": "Instructions", "text": "Text to rephrase", "questions": "Questions to address",
}


def stable_hash(value: str) -> int:
    result = 2166136261
    encoded = value.encode("utf-16-le")
    for index in range(0, len(encoded), 2):
        result ^= encoded[index] | (encoded[index + 1] << 8)
        result = (result * 16777619) & 0xFFFFFFFF
    return result


def choose(items: list[Any], seed: str) -> Any:
    return items[stable_hash(seed) % len(items)]


def choose_many(items: list[Any], count: int, seed: str) -> list[Any]:
    remaining = items.copy()
    selected: list[Any] = []
    cursor = stable_hash(seed)
    while remaining and len(selected) < count:
        selected.append(remaining.pop(cursor % len(remaining)))
        cursor = stable_hash(f"{seed}:{cursor}:{len(selected)}")
    return selected


def get_offline_drill_prompt(drill_type: str, client_session_id: str, *,
                             version: str = "drills-v1", department: str | None = None) -> dict[str, Any]:
    if version not in {"drills-v1", "drills-v2"}:
        raise ValueError("Unsupported offline Drill question-pack version.")
    seed = f"{client_session_id}:{drill_type}"
    if version == "drills-v2" and drill_type in {"fast_word", "fake_profile", "taboo", "elevator_pitch", "rephrase", "positive_framing", "crisis"}:
        normalized = normalize_drill_department(department)
        if normalized is None:
            raise InvalidDrillDepartmentError("A supported department is required for this Drill.")
        field_seed = f"{seed}:{normalized}"
        if drill_type == "fast_word":
            return {"word": choose(V2_FIELD_POOLS["fast_word"][normalized], field_seed)}
        if drill_type == "fake_profile":
            return {
                "name": choose(POOLS["names"], f"{seed}:name"),
                "age": choose(POOLS["ages"], f"{seed}:age"),
                "job": choose(V2_FIELD_POOLS["fake_profile_jobs"][normalized], f"{field_seed}:job"),
                "hobby": choose(POOLS["hobbies"], f"{seed}:hobby"),
            }
        pool_key = "crisis_scenarios" if drill_type == "crisis" else drill_type
        selected = choose(V2_SHARED_POOLS[pool_key] + V2_FIELD_POOLS[pool_key][normalized], field_seed if drill_type != "crisis" else f"{field_seed}:scenario")
        if drill_type == "taboo":
            return selected
        if drill_type in {"elevator_pitch", "rephrase", "positive_framing"}:
            key = {"elevator_pitch": "scenario", "rephrase": "text", "positive_framing": "complaint"}[drill_type]
            return {key: selected}
        return {"scenario": selected, "questions": choose_many(POOLS["crisis_questions"], 4, f"{seed}:questions")}
    if drill_type in {"jam", "fast_word", "synonym"}:
        return {"word" if drill_type != "jam" else "topic": choose(POOLS[drill_type], seed)}
    if drill_type == "emotion":
        return {"sentence": choose(POOLS["emotion_sentences"], f"{seed}:sentence"), "emotion": choose(POOLS["emotions"], f"{seed}:emotion")}
    if drill_type == "fake_profile":
        return {key: choose(POOLS[pool], f"{seed}:{key}") for key, pool in (("name", "names"), ("age", "ages"), ("job", "jobs"), ("hobby", "hobbies"))}
    if drill_type == "emoji_story":
        return {"emojis": choose_many(POOLS["emojis"], 3, seed)}
    if drill_type == "taboo":
        return choose(POOLS["taboo"], seed)
    if drill_type in {"elevator_pitch", "rephrase", "positive_framing"}:
        key = {"elevator_pitch": "scenario", "rephrase": "text", "positive_framing": "complaint"}[drill_type]
        return {key: choose(POOLS[drill_type], seed)}
    if drill_type == "crisis":
        return {"scenario": choose(POOLS["crisis_scenarios"], f"{seed}:scenario"), "questions": choose_many(POOLS["crisis_questions"], 4, f"{seed}:questions")}
    if drill_type == "negotiation":
        return {
            "scenario": "You are negotiating a starting salary. The employer opens with ₱35,000 and is strict about the budget.",
            "instruction": "Reply professionally. You can accept, negotiate salary, or ask about benefits.",
        }
    raise ValueError("Unsupported offline Drill type.")


def format_offline_drill_prompt(prompt: dict[str, Any]) -> str:
    return "\n".join(
        f"{LABELS[key]}: {', '.join(str(item) for item in value) if isinstance(value, list) else value}"
        for key, value in prompt.items()
    )

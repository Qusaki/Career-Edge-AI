import datetime
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from core.drill_progression import DRILL_LEVEL_BY_TYPE
from core.offline_drill_prompt import format_offline_drill_prompt, get_offline_drill_prompt
from core.scoring import bounded_integer_score, bounded_score
from models.drills import DrillSession
from models.post_test_interview import PostTestInterviewMessage, PostTestInterviewSession
from models.pre_test_active_listening import PreTestActiveListeningMessage, PreTestActiveListeningSession
from models.pre_test_intro import PreTestIntroSession
from models.thesis_interview import ThesisInterviewMessage, ThesisInterviewSession
from models.upcoming_student_interview import UpcomingStudentInterviewMessage, UpcomingStudentInterviewSession
from models.user import User
from routers.thesis_interview import get_thesis_evaluation_score_keys, get_thesis_evaluation_system_prompt
from routers.upcoming_student_interview import get_evaluation_score_keys, get_evaluation_system_prompt
from routers.pre_test_active_listening import ACTIVE_LISTENING_PROMPTS
from routers.post_test_interview import get_post_test_questions
from schemas.offline_sync import OfflineSyncRequest
from services.ai_provider import AIProvider, get_ai_provider
from services.interview_ai import collect_ai_response, parse_evaluation_response
from services.assessment_scoring import score_drill, score_intro, score_listening, score_post_test


SUPPORTED_PACK_VERSIONS = {
    "pre_test_intro": "pretest-who-am-i-v1",
    "pre_test_active_listening": "pretest-active-listening-v1",
    "post_test": "posttest-v1",
    "drill": "drills-v1",
    "upcoming": "enrollment-interview-v1",
    "thesis": "thesis-interview-v1",
}

INTERVIEW_QUESTION_IDS = {
    "upcoming": {
        "CCIT": ["ccit-track", "ccit-technical-fundamentals", "ccit-problem-solving", "ccit-coding-basics", "ccit-communication-soft-skills"],
        "CTE": ["cte-major", "cte-subject-teaching", "cte-motivation-values", "cte-problem-solving", "cte-leadership-preparation"],
        "CBAPA": ["cbapa-major", "cbapa-business-fundamentals", "cbapa-analysis", "cbapa-entrepreneurship-leadership", "cbapa-ethics-preparation"],
    },
    "thesis": {
        "CCIT": ["ccit-technical-innovation", "ccit-implementation-performance", "ccit-experimental-validation", "ccit-related-work", "ccit-demo-limitations"],
        "CTE": ["cte-pedagogical-innovation", "cte-action-research", "cte-learning-outcomes", "cte-literature-deped", "cte-demo-scalability"],
        "CBAPA": ["cbapa-research-problem", "cbapa-methodology", "cbapa-practical-roi", "cbapa-literature-framework", "cbapa-delivery-limitations"],
    },
}

SESSION_MODELS = {
    "pre_test_intro": PreTestIntroSession,
    "pre_test_active_listening": PreTestActiveListeningSession,
    "post_test": PostTestInterviewSession,
    "drill": DrillSession,
    "upcoming": UpcomingStudentInterviewSession,
    "thesis": ThesisInterviewSession,
}


def get_owned_native_session(
    db: Session,
    user: User,
    activity_type: str,
    server_session_id: int,
):
    model = SESSION_MODELS[activity_type]
    return db.query(model).filter(
        model.id == server_session_id,
        model.user_id == user.id,
    ).first()


def validate_sync_payload(payload: OfflineSyncRequest, department: str) -> None:
    normalized_department = department.upper() if department else ""
    if payload.activity_type in {"post_test", "upcoming", "thesis"} and normalized_department not in {"CCIT", "CTE", "CBAPA"}:
        raise HTTPException(status_code=403, detail="This activity is not available for the authenticated department.")
    expected_version = SUPPORTED_PACK_VERSIONS[payload.activity_type]
    if payload.question_pack_version != expected_version:
        raise HTTPException(status_code=409, detail="This offline question-pack version is not supported.")
    if payload.activity_type in {"upcoming", "thesis"}:
        submitted = payload.activity_state.get("questionIds")
        expected = INTERVIEW_QUESTION_IDS[payload.activity_type][normalized_department]
        if submitted != expected:
            raise HTTPException(status_code=409, detail="The offline interview question order does not match the canonical pack.")
    if payload.activity_type == "pre_test_active_listening":
        prompts = [turn.text for turn in payload.conversation_log if turn.sender == "ai"]
        if not prompts or prompts[0] not in ACTIVE_LISTENING_PROMPTS:
            raise HTTPException(status_code=409, detail="The Active Listening story does not match the canonical pack.")
    if payload.activity_type == "post_test":
        submitted_questions = [turn.text for turn in payload.conversation_log if turn.sender == "ai"][:5]
        if submitted_questions != get_post_test_questions(department):
            raise HTTPException(status_code=409, detail="The Post-Test question order does not match the canonical pack.")
    if payload.activity_type == "drill":
        drill_type = payload.activity_state.get("drillType")
        drill_level = payload.activity_state.get("drillLevel")
        if not isinstance(drill_type, str) or not 1 <= len(drill_type) <= 64:
            raise HTTPException(status_code=422, detail="Drill type is required.")
        if not isinstance(drill_level, str) or not 1 <= len(drill_level) <= 32:
            raise HTTPException(status_code=422, detail="Drill level is required.")
        if DRILL_LEVEL_BY_TYPE.get(drill_type) != drill_level:
            raise HTTPException(status_code=422, detail="Unsupported Drill level/type combination.")
        if payload.server_session_id is None and "prompt" in payload.activity_state:
            expected_prompt = format_offline_drill_prompt(get_offline_drill_prompt(drill_type, payload.client_session_id))
            if payload.activity_state["prompt"] != expected_prompt:
                raise HTTPException(status_code=409, detail="The offline Drill prompt does not match the canonical pack.")
    pending_audio_steps = {
        item.answer_index for item in payload.audio_manifest if item.transcript_status == "pending"
    }
    submitted_steps = {answer.step for answer in payload.answers if answer.text.strip()}
    if pending_audio_steps - submitted_steps:
        raise HTTPException(status_code=409, detail="A required audio response still needs transcription or a typed answer.")


def get_owned_existing_session(db: Session, user: User, payload: OfflineSyncRequest):
    if payload.server_session_id is None:
        return None
    model = SESSION_MODELS[payload.activity_type]
    session = db.query(model).filter(model.id == payload.server_session_id).first()
    if session is not None:
        if session.user_id != user.id:
            raise HTTPException(status_code=403, detail="The supplied server session does not belong to this account.")
        return session
    for other_type, other_model in SESSION_MODELS.items():
        if other_type == payload.activity_type:
            continue
        other = db.query(other_model).filter(
            other_model.id == payload.server_session_id,
            other_model.user_id == user.id,
        ).first()
        if other is not None:
            raise HTTPException(status_code=409, detail="The supplied server session belongs to a different activity type.")
    raise HTTPException(status_code=404, detail="The supplied server session was not found.")


def serialize_session(session: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for column in inspect(session).mapper.column_attrs:
        if column.key == "user_id":
            continue
        value = getattr(session, column.key)
        result[column.key] = value.isoformat() if isinstance(value, datetime.datetime) else value
    return result


async def _interview_evaluation(payload: OfflineSyncRequest, user: User, provider: AIProvider) -> dict[str, Any]:
    transcript = "\n".join(
        f"{'PROFESSOR' if turn.sender == 'ai' else 'STUDENT'}: {turn.text}"
        for turn in payload.conversation_log
    )
    if payload.activity_type == "upcoming":
        prompt = get_evaluation_system_prompt(user.department)
        keys = get_evaluation_score_keys(user.department)
        workload = "enrollment_evaluation"
    else:
        prompt = get_thesis_evaluation_system_prompt(user.department)
        keys = get_thesis_evaluation_score_keys(user.department)
        workload = "thesis_evaluation"
        abstract_context = str(payload.activity_state.get("thesisAbstractContext") or "").strip()
        if abstract_context:
            transcript = f"THESIS ABSTRACT CONTEXT:\n{abstract_context}\n\nDEFENSE TRANSCRIPT:\n{transcript}"
    response = await collect_ai_response(provider, [
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"Evaluate this completed transcript. Return only the required JSON object.\n\n{transcript}"},
    ], workload=workload)
    return parse_evaluation_response(response, keys)


def _scoring_provider(provider: AIProvider | None) -> AIProvider | None:
    if provider is not None:
        return provider
    try:
        return get_ai_provider()
    except Exception:
        # The scoring service converts an unavailable configuration/provider to
        # an explicit conservative fallback without failing synchronization.
        return None


async def evaluate_payload(payload: OfflineSyncRequest, user: User, provider: AIProvider | None = None,
                           *, drill_prompt: dict[str, Any] | None = None) -> dict[str, Any]:
    if payload.activity_type == "pre_test_intro":
        return await score_intro(payload.answers[0].text, _scoring_provider(provider))
    if payload.activity_type == "post_test":
        return await score_post_test(get_post_test_questions(user.department), [answer.text for answer in payload.answers], _scoring_provider(provider))
    if payload.activity_type == "drill":
        drill_type = str(payload.activity_state["drillType"])
        prompt = drill_prompt or get_offline_drill_prompt(drill_type, payload.client_session_id)
        if drill_type == "negotiation":
            prompt = {
                **prompt,
                "employer_turns": [turn.text for turn in payload.conversation_log if turn.sender == "ai"],
            }
        evaluation_data = {
            "spoken_response": payload.answers[0].text if drill_type != "negotiation" else "",
            "negotiation_messages": [
                {"sender": "user", "text": answer.text} for answer in payload.answers
            ] if drill_type == "negotiation" else [],
            "prompt": prompt,
        }
        return await score_drill(drill_type, evaluation_data, _scoring_provider(provider))
    if payload.activity_type == "pre_test_active_listening":
        story = next((turn.text for turn in payload.conversation_log if turn.sender == "ai"), "")
        summary = " ".join(answer.text for answer in payload.answers)
        return await score_listening(story, summary, _scoring_provider(provider))
    resolved_provider = provider or get_ai_provider()
    return await _interview_evaluation(payload, user, resolved_provider)


def _apply_eye_contact(session: Any, payload: OfflineSyncRequest) -> None:
    summary = payload.eye_contact_summary
    session.eye_contact_samples = summary.samples if summary else 0
    session.score_eye_contact = summary.score if summary and summary.samples > 0 else None


def _apply_five_point_scores(session: Any, evaluation: dict[str, Any]) -> None:
    for field in ["vocabulary", "clarity", "grammar", "courtesy", "conciseness"]:
        setattr(session, f"score_{field}", bounded_integer_score(evaluation, f"score_{field}", minimum=1, maximum=5, default=1))
    session.total_score = float(sum(getattr(session, f"score_{field}") for field in ["vocabulary", "clarity", "grammar", "courtesy", "conciseness"]))
    session.passed = session.total_score >= 17.0
    session.feedback_summary = str(evaluation.get("feedback_summary") or "")[:8_000]


def _apply_interview_scores(session: Any, payload: OfflineSyncRequest, user: User, evaluation: dict[str, Any]) -> None:
    department = user.department.upper()
    score = lambda key: bounded_score(evaluation, key, minimum=0, maximum=100, default=0)
    if payload.activity_type == "upcoming":
        if department == "CTE":
            fields = [("score_cte_subject_matter", "subject_matter_score", .25), ("score_cte_teaching", "teaching_aptitude_score", .20), ("score_cte_communication", "communication_score", .20), ("score_cte_motivation", "motivation_score", .15), ("score_cte_academic", "academic_preparedness_score", .10), ("score_cte_problem_solving", "problem_solving_score", .05), ("score_cte_leadership", "leadership_score", .05)]
        elif department == "CBAPA":
            fields = [("score_cbapa_business", "business_fundamentals_score", .25), ("score_cbapa_analytical", "analytical_score", .20), ("score_cbapa_communication", "communication_score", .15), ("score_cbapa_entrepreneurial", "entrepreneurial_score", .15), ("score_cbapa_academic", "academic_preparedness_score", .10), ("score_cbapa_leadership", "leadership_score", .10), ("score_cbapa_ethical", "ethical_score", .05)]
        else:
            fields = [("score_technical", "technical_score", .30), ("score_problem_solving", "problem_solving_score", .25), ("score_coding", "coding_score", .20), ("score_communication", "communication_score", .15), ("score_soft_skills", "soft_skills_score", .10)]
    elif department == "CTE":
        fields = [("score_cte_pedagogical_innovation", "pedagogical_innovation_score", .25), ("score_cte_action_research", "action_research_score", .20), ("score_cte_learning_outcomes", "learning_outcomes_score", .20), ("score_cte_literature_alignment", "literature_alignment_score", .15), ("score_cte_teaching_demo", "teaching_demo_score", .10), ("score_cte_scalability_policy", "scalability_policy_score", .10)]
    elif department == "CBAPA":
        fields = [("score_cbapa_research_problem", "research_problem_score", .25), ("score_cbapa_methodology_analysis", "methodology_analysis_score", .25), ("score_cbapa_practical_roi", "practical_roi_score", .20), ("score_cbapa_literature_theoretical", "literature_theoretical_score", .15), ("score_cbapa_professional_delivery", "professional_delivery_score", .15)]
    else:
        fields = [("score_ccit_technical_innovation", "technical_innovation_score", .30), ("score_ccit_system_implementation", "system_implementation_score", .25), ("score_ccit_experimental_validation", "experimental_validation_score", .20), ("score_ccit_literature_review", "literature_review_score", .15), ("score_ccit_demo_quality", "demo_quality_score", .10)]
    total = 0.0
    for target, source, weight in fields:
        value = score(source)
        setattr(session, target, value)
        total += value * weight
    session.total_score = round(total, 2)
    session.passed = session.total_score >= 70.0
    session.feedback_summary = str(evaluation.get("feedback_summary") or "")[:8_000]


def persist_authoritative_result(
    db: Session,
    payload: OfflineSyncRequest,
    user: User,
    evaluation: dict[str, Any],
    existing_session: Any | None,
) -> Any:
    now = datetime.datetime.utcnow()
    if existing_session is not None and existing_session.status == "completed":
        return existing_session
    session = existing_session
    if session is None:
        if payload.activity_type == "drill":
            session = DrillSession(
                user_id=user.id,
                drill_type=str(payload.activity_state["drillType"]),
                drill_level=str(payload.activity_state["drillLevel"]),
            )
        else:
            session = SESSION_MODELS[payload.activity_type](user_id=user.id)
        db.add(session)
        db.flush()

    if payload.activity_type == "pre_test_intro":
        session.transcript = payload.answers[0].text
        for field in ["clarity", "completeness", "courtesy", "correctness", "conciseness"]:
            setattr(session, f"score_{field}", bounded_integer_score(evaluation, f"score_{field}", minimum=1, maximum=3, default=1))
        session.score_vocabulary = bounded_integer_score(evaluation, "score_vocabulary", minimum=1, maximum=5, default=1)
        session.score_grammar = bounded_integer_score(evaluation, "score_grammar", minimum=1, maximum=5, default=1)
        session.total_score = float(sum(getattr(session, f"score_{field}") for field in ["clarity", "completeness", "courtesy", "correctness", "conciseness"]))
        session.passed = session.total_score >= 10.0
        session.feedback_summary = str(evaluation.get("feedback_summary") or "")[:8_000]
        _apply_eye_contact(session, payload)
    elif payload.activity_type in {"pre_test_active_listening", "post_test"}:
        _apply_five_point_scores(session, evaluation)
        _apply_eye_contact(session, payload)
    elif payload.activity_type == "drill":
        session.score = evaluation["score"]
        session.passed = evaluation["passed"]
        session.feedback_summary = evaluation["feedback_summary"]
        session.evaluation_data = json.dumps(evaluation, sort_keys=True)
        _apply_eye_contact(session, payload)
    else:
        _apply_interview_scores(session, payload, user, evaluation)
        _apply_eye_contact(session, payload)

    message_model = {
        "pre_test_active_listening": PreTestActiveListeningMessage,
        "post_test": PostTestInterviewMessage,
        "upcoming": UpcomingStudentInterviewMessage,
        "thesis": ThesisInterviewMessage,
    }.get(payload.activity_type)
    if message_model is not None:
        db.query(message_model).filter(message_model.session_id == session.id).delete(synchronize_session=False)
        for turn in payload.conversation_log:
            db.add(message_model(session_id=session.id, role=turn.sender, content=turn.text))

    session.status = "completed"
    session.end_time = now
    db.flush()
    return session

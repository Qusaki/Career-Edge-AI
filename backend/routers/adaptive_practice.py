"""Optional online-only, user-owned Adaptive Practice API."""

import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.adaptive_priority import CRITERIA
from core.deps import get_current_user
from database import get_db
from models.adaptive_practice import AdaptivePracticeSession
from models.user import User
from schemas.adaptive_practice import (
    AdaptiveCompleteRequest, AdaptiveCompleteResponse, AdaptiveHistoryItem,
    AdaptiveSessionResponse, AdaptiveStartRequest,
)
from services.adaptive_practice import (
    EVALUATION_VERSION, GENERATION_VERSION, generate_adaptive_prompt,
    get_adaptive_recommendation, prompt_fingerprint,
)
from services.assessment_scoring import score_adaptive_practice


router = APIRouter()


def _owned(db: Session, user_id: int, session_id: int, *, lock: bool = False) -> AdaptivePracticeSession:
    query = db.query(AdaptivePracticeSession).filter(
        AdaptivePracticeSession.id == session_id,
        AdaptivePracticeSession.user_id == user_id,
    )
    session = (query.with_for_update() if lock else query).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Adaptive Practice session not found.")
    return session


@router.get("/recommendation")
def recommendation(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_adaptive_recommendation(db, current_user.id)


@router.get("/", response_model=list[AdaptiveHistoryItem])
def history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    recent = db.query(AdaptivePracticeSession).filter(AdaptivePracticeSession.user_id == current_user.id).order_by(
        AdaptivePracticeSession.started_at.desc(), AdaptivePracticeSession.id.desc(),
    ).limit(50).all()
    active = db.query(AdaptivePracticeSession).filter(
        AdaptivePracticeSession.user_id == current_user.id,
        AdaptivePracticeSession.status.in_(("generating", "in_progress", "evaluating")),
    ).order_by(AdaptivePracticeSession.id.desc()).first()
    return [active, *recent] if active and all(item.id != active.id for item in recent) else recent


@router.post("/start", response_model=AdaptiveSessionResponse)
async def start(
    request: AdaptiveStartRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    attempt_id = str(request.client_attempt_id)
    # Serialize starts for one account in PostgreSQL; the unique key also protects retries.
    db.query(User).filter(User.id == current_user.id).with_for_update().one()
    existing = db.query(AdaptivePracticeSession).filter(
        AdaptivePracticeSession.user_id == current_user.id,
        AdaptivePracticeSession.client_attempt_id == attempt_id,
    ).first()
    if existing:
        return existing
    active = db.query(AdaptivePracticeSession).filter(
        AdaptivePracticeSession.user_id == current_user.id,
        AdaptivePracticeSession.status.in_(("generating", "in_progress", "evaluating")),
    ).order_by(AdaptivePracticeSession.id.desc()).first()
    if active:
        return active
    profile = get_adaptive_recommendation(db, current_user.id)
    target = profile["priority_criterion"]
    if target is None:
        raise HTTPException(status_code=409, detail=profile["reason"])
    department = current_user.department if current_user.department in {"CCIT", "CTE", "CBAPA"} else None
    session = AdaptivePracticeSession(
        user_id=current_user.id, client_attempt_id=attempt_id,
        target_criterion=target, difficulty=profile["difficulty"], department=department,
        generation_version=GENERATION_VERSION, status="generating",
    )
    db.add(session)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        found = db.query(AdaptivePracticeSession).filter(
            AdaptivePracticeSession.user_id == current_user.id,
            AdaptivePracticeSession.client_attempt_id == attempt_id,
        ).first()
        if found:
            return found
        raise
    db.refresh(session)
    recent = db.query(AdaptivePracticeSession).filter(
        AdaptivePracticeSession.user_id == current_user.id,
        AdaptivePracticeSession.id != session.id,
        AdaptivePracticeSession.scenario_category.isnot(None),
    ).order_by(AdaptivePracticeSession.id.desc()).limit(5).all()
    generated, authority = await generate_adaptive_prompt(
        target, session.difficulty, department, profile["scores"][target],
        [item.scenario_category for item in recent],
        [item.prompt_fingerprint for item in recent if item.prompt_fingerprint],
    )
    locked = _owned(db, current_user.id, session.id, lock=True)
    if locked.status == "generating":
        locked.scenario_category = generated["scenario_category"]
        locked.scenario = generated["scenario"]
        locked.prompt = generated["prompt"]
        locked.prompt_fingerprint = prompt_fingerprint(locked.scenario, locked.prompt)
        locked.generation_authority = authority
        locked.status = "in_progress"
        db.commit()
        db.refresh(locked)
    return locked


@router.get("/{session_id}", response_model=AdaptiveSessionResponse)
def detail(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _owned(db, current_user.id, session_id)


@router.post("/{session_id}/abandon", response_model=AdaptiveSessionResponse)
def abandon(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = _owned(db, current_user.id, session_id, lock=True)
    if session.status == "completed":
        raise HTTPException(status_code=409, detail="Completed Adaptive Practice cannot be abandoned.")
    if session.status == "evaluating":
        raise HTTPException(status_code=409, detail="Evaluation is in progress.")
    if session.status != "abandoned":
        session.status = "abandoned"
        db.commit()
        db.refresh(session)
    return session


@router.post("/{session_id}/complete", response_model=AdaptiveCompleteResponse)
async def complete(
    session_id: int, request: AdaptiveCompleteRequest,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    response = request.response_text.strip()
    if not response:
        raise HTTPException(status_code=422, detail="A spoken response is required.")
    session = _owned(db, current_user.id, session_id, lock=True)
    if session.status == "completed":
        return {"session": session, "next_recommendation": get_adaptive_recommendation(db, current_user.id)}
    if session.status != "in_progress" or not session.scenario or not session.prompt:
        raise HTTPException(status_code=409, detail="This Adaptive Practice session is not ready for evaluation.")
    session.response_text = response
    session.status = "evaluating"
    db.commit()
    try:
        result = await score_adaptive_practice(session.target_criterion, session.scenario, session.prompt, response)
    except Exception:
        session = _owned(db, current_user.id, session_id, lock=True)
        session.status = "in_progress"
        db.commit()
        raise
    session = _owned(db, current_user.id, session_id, lock=True)
    if session.status != "evaluating":
        raise HTTPException(status_code=409, detail="Adaptive Practice session state changed during evaluation.")
    for key in (*CRITERIA, "task_completion"):
        setattr(session, f"score_{key}", result["criteria"][key])
    session.score_total = result["score_total"]
    session.passed = result["passed"]
    session.feedback_summary = result["feedback_summary"]
    session.scoring_authority = result["scoring_authority"]
    session.evaluation_version = EVALUATION_VERSION
    session.status = "completed"
    session.completed_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(session)
    return {"session": session, "next_recommendation": get_adaptive_recommendation(db, current_user.id)}

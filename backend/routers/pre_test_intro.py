import datetime
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.deps import get_current_user
from core.scoring import bounded_integer_score
from models.user import User
from models.pre_test_intro import PreTestIntroSession
from schemas.pre_test_intro import PreTestIntroCompleteRequest, PreTestIntroResponseRequest, PreTestIntroSessionResponse

router = APIRouter()

@router.post("/start", response_model=PreTestIntroSessionResponse)
def start_intro_session(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Starts or resumes the active pre-test 'Who Am I?' introduction session."""
    active_session = db.query(PreTestIntroSession).filter(
        PreTestIntroSession.user_id == current_user.id,
        PreTestIntroSession.status == "active",
    ).order_by(PreTestIntroSession.start_time.desc()).first()
    if active_session:
        return active_session

    session = PreTestIntroSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.put("/{session_id}/response", response_model=PreTestIntroSessionResponse)
def persist_intro_response(
    session_id: int,
    request: PreTestIntroResponseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Persists the one canonical accepted response for an active Who Am I session."""
    transcript = request.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="A non-empty introduction response is required.")

    session = (
        db.query(PreTestIntroSession)
        .filter(
            PreTestIntroSession.id == session_id,
            PreTestIntroSession.user_id == current_user.id,
        )
        .with_for_update()
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.status != "active":
        raise HTTPException(status_code=409, detail="Completed introduction sessions cannot be changed.")

    if session.transcript != transcript:
        session.transcript = transcript
        db.commit()
        db.refresh(session)
    return session

@router.get("/", response_model=List[PreTestIntroSessionResponse])
def get_user_intro_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past pre-test introduction sessions for the authenticated user."""
    sessions = db.query(PreTestIntroSession).filter(PreTestIntroSession.user_id == current_user.id).order_by(PreTestIntroSession.start_time.desc()).all()
    return sessions

@router.post("/{session_id}/complete", response_model=PreTestIntroSessionResponse)
def complete_intro_session(session_id: int, request: PreTestIntroCompleteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Completes and grades the pre-test introduction session."""
    session = (
        db.query(PreTestIntroSession)
        .filter(
            PreTestIntroSession.id == session_id,
            PreTestIntroSession.user_id == current_user.id,
        )
        .with_for_update()
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    if session.status == "completed":
        return session
        
    if not request.evaluation:
        raise HTTPException(status_code=400, detail="Missing frontend evaluation data.")

    persisted_transcript = session.transcript.strip() if session.transcript else ""
    submitted_transcript = request.transcript.strip() if request.transcript else ""
    canonical_transcript = persisted_transcript or submitted_transcript
    if not canonical_transcript:
        raise HTTPException(status_code=400, detail="A non-empty introduction response is required.")
        
    try:
        evaluation = request.evaluation
        
        session.score_clarity = bounded_integer_score(evaluation, "score_clarity", minimum=1, maximum=3, default=1)
        session.score_completeness = bounded_integer_score(evaluation, "score_completeness", minimum=1, maximum=3, default=1)
        session.score_courtesy = bounded_integer_score(evaluation, "score_courtesy", minimum=1, maximum=3, default=1)
        session.score_correctness = bounded_integer_score(evaluation, "score_correctness", minimum=1, maximum=3, default=1)
        session.score_conciseness = bounded_integer_score(evaluation, "score_conciseness", minimum=1, maximum=3, default=1)
        session.score_vocabulary = bounded_integer_score(evaluation, "score_vocabulary", minimum=1, maximum=5, default=1)
        session.score_grammar = bounded_integer_score(evaluation, "score_grammar", minimum=1, maximum=5, default=1)
        session.eye_contact_samples = bounded_integer_score(
            evaluation, "eye_contact_samples", minimum=0, maximum=10_000_000, default=0
        )
        eye_contact_score = evaluation.get("eye_contact_score")
        session.score_eye_contact = (
            bounded_integer_score(evaluation, "eye_contact_score", minimum=0, maximum=100, default=0)
            if session.eye_contact_samples > 0 and eye_contact_score is not None
            else None
        )
        session.feedback_summary = evaluation.get("feedback_summary", "")
        session.transcript = canonical_transcript
        
        # Calculate total score out of 15 (5 criteria * 3 max points).
        total = (
            session.score_clarity +
            session.score_completeness +
            session.score_courtesy +
            session.score_correctness +
            session.score_conciseness
        )
        
        session.total_score = float(total)
        # Passing threshold remains two-thirds of the available points.
        session.passed = session.total_score >= 10.0
        
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save evaluation: {e}")

@router.get("/{session_id}", response_model=PreTestIntroSessionResponse)
def get_intro_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gets details of a specific pre-test introduction session."""
    session = db.query(PreTestIntroSession).filter(PreTestIntroSession.id == session_id, PreTestIntroSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session

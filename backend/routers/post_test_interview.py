import json
import datetime
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.deps import get_current_user, get_current_user_ws
from core.scoring import bounded_integer_score
from models.user import User
from models.post_test_interview import PostTestInterviewSession, PostTestInterviewMessage
from schemas.post_test_interview import PostTestInterviewSessionResponse, PostTestInterviewSessionWithMessagesResponse, PostTestInterviewCompleteRequest

router = APIRouter()

def get_post_test_questions(department: str) -> List[str]:
    """Dedicated Post-Test questions; never use enrollment/application prompts here."""
    dep = department.upper() if department else ""
    if dep == "CTE":
        context_question = (
            "Tell me about a time you explained a difficult lesson or idea to someone. "
            "How did you make sure they understood you?"
        )
    elif dep == "CBAPA":
        context_question = (
            "Tell me about a time you explained difficult business, financial, or policy information. "
            "How did you make it clear to your listener?"
        )
    else:
        context_question = (
            "Tell me about a time you explained a difficult technical idea to someone. "
            "How did you make sure they understood you?"
        )

    return [
        (
            "Please introduce yourself briefly and describe one "
            "communication skill you have improved during your training."
        ),
        context_question,
        (
            "Can you describe a challenging situation where you had "
            "to solve a problem, explain the steps you took, and share what you learned from the experience?"
        ),
        (
            "Imagine that you disagree with a teammate during an important "
            "task. How would you communicate your concern respectfully and help the group reach a decision?"
        ),
        (
            "What communication skill do you still want to improve, and what "
            "specific actions will you take to improve it?"
        ),
    ]

def get_post_test_question_three() -> str:
    return get_post_test_questions("")[2]

@router.post("/start", response_model=PostTestInterviewSessionResponse)
def start_session(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Starts or resumes the active Post-test Interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")

    active_session = db.query(PostTestInterviewSession).filter(
        PostTestInterviewSession.user_id == current_user.id,
        PostTestInterviewSession.status == "active",
    ).order_by(PostTestInterviewSession.start_time.desc()).first()
    if active_session:
        first_ai_turn = db.query(PostTestInterviewMessage).filter(
            PostTestInterviewMessage.session_id == active_session.id,
            PostTestInterviewMessage.role == "ai",
        ).order_by(PostTestInterviewMessage.timestamp.asc(), PostTestInterviewMessage.id.asc()).first()
        expected_first_question = get_post_test_questions(current_user.department)[0]
        if first_ai_turn and first_ai_turn.content == expected_first_question:
            return active_session

        # Enrollment-contaminated and pre-persistence sessions cannot resume
        # with the dedicated Post-Test sequence, so replace them cleanly.
        active_session.status = "expired"
        active_session.end_time = datetime.datetime.utcnow()
        db.commit()

    session = PostTestInterviewSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.get("/", response_model=List[PostTestInterviewSessionResponse])
def get_user_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past post-test interview sessions for the user."""
    sessions = db.query(PostTestInterviewSession).filter(PostTestInterviewSession.user_id == current_user.id).order_by(PostTestInterviewSession.start_time.desc()).all()
    session_ids = [session.id for session in sessions]
    answered_by_session = {session_id: 0 for session_id in session_ids}
    if session_ids:
        user_messages = db.query(PostTestInterviewMessage.session_id).filter(
            PostTestInterviewMessage.session_id.in_(session_ids),
            PostTestInterviewMessage.role == "user",
        ).all()
        for (session_id,) in user_messages:
            answered_by_session[session_id] += 1

    for session in sessions:
        answered_questions = answered_by_session[session.id]
        session.answered_questions = answered_questions
        session.question_number = min(answered_questions + 1, 5)
    return sessions

@router.websocket("/{session_id}/chat")
async def post_test_chat_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional streaming for Post-Test Interview exercise."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Forbidden: Department not authorized.")
        return

    session = db.query(PostTestInterviewSession).filter(PostTestInterviewSession.id == session_id, PostTestInterviewSession.user_id == current_user.id).first()
    if not session:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session not found.")
        return
        
    if session.status != "active":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=f"Session is already {session.status}.")
        return
        
    time_elapsed = datetime.datetime.utcnow() - session.start_time
    if time_elapsed.total_seconds() > 3600:
        session.status = "expired"
        db.commit()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Time limit exceeded.")
        return

    await websocket.accept()

    post_test_questions = get_post_test_questions(current_user.department)
    stored_history = db.query(PostTestInterviewMessage).filter(
        PostTestInterviewMessage.session_id == session.id
    ).order_by(PostTestInterviewMessage.timestamp.asc(), PostTestInterviewMessage.id.asc()).all()
    
    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    if data.get("text"):
                        user_text = data["text"]

                        if user_text.strip() == "/start_interview":
                            latest_ai_message = next(
                                (item for item in reversed(stored_history) if item.role == "ai"),
                                None,
                            )
                            if latest_ai_message:
                                await websocket.send_json({"text": latest_ai_message.content})
                                await websocket.send_json({"type": "turn_complete"})
                                continue

                            opening_prompt = post_test_questions[0]
                            opening_message = PostTestInterviewMessage(
                                session_id=session.id,
                                role="ai",
                                content=opening_prompt,
                            )
                            db.add(opening_message)
                            db.commit()
                            db.refresh(opening_message)
                            stored_history.append(opening_message)
                            await websocket.send_json({"text": opening_prompt})
                            await websocket.send_json({"type": "turn_complete"})
                            continue

                        user_message = PostTestInterviewMessage(
                            session_id=session.id,
                            role="user",
                            content=user_text,
                        )
                        db.add(user_message)
                        db.commit()
                        db.refresh(user_message)
                        stored_history.append(user_message)

                        completed_question_count = sum(
                            1 for item in stored_history
                            if item.role == "ai" and item.content in post_test_questions
                        )
                        if completed_question_count < len(post_test_questions):
                            next_question = post_test_questions[completed_question_count]
                            next_question_message = PostTestInterviewMessage(
                                session_id=session.id,
                                role="ai",
                                content=next_question,
                            )
                            db.add(next_question_message)
                            db.commit()
                            db.refresh(next_question_message)
                            stored_history.append(next_question_message)
                            await websocket.send_json({"text": next_question})
                            await websocket.send_json({"type": "turn_complete"})
                            continue

                        completion_message = (
                            "You have completed all five Post-Test questions. "
                            "Please click Complete Interview to view your assessment."
                        )
                        completion_ai_message = PostTestInterviewMessage(
                            session_id=session.id,
                            role="ai",
                            content=completion_message,
                        )
                        db.add(completion_ai_message)
                        db.commit()
                        db.refresh(completion_ai_message)
                        stored_history.append(completion_ai_message)
                        await websocket.send_json({"text": completion_message})
                        await websocket.send_json({"type": "turn_complete"})
                        
                except Exception as e:
                    print(f"[DEBUG] Post-Test question flow error: {e}")
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "message": "The Post-Test question could not be loaded. Please try again.",
                        })
                        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                    except Exception:
                        pass
                    return
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Post-Test question flow failed.")
        except:
            pass

@router.post("/{session_id}/complete", response_model=PostTestInterviewSessionResponse)
def complete_session(session_id: int, request: PostTestInterviewCompleteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Completes and grades the post-test interview session."""
    session = db.query(PostTestInterviewSession).filter(PostTestInterviewSession.id == session_id, PostTestInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    if session.status == "completed":
        return session
        
    # Build Transcript
    history = db.query(PostTestInterviewMessage).filter(PostTestInterviewMessage.session_id == session.id).order_by(PostTestInterviewMessage.timestamp.asc()).all()
    if not history and request.conversation:
        for item in request.conversation:
            new_msg = PostTestInterviewMessage(session_id=session.id, role=item.sender, content=item.text)
            db.add(new_msg)
        db.commit()
        
    if not request.evaluation:
        raise HTTPException(status_code=400, detail="Missing frontend evaluation data.")
        
    try:
        evaluation = request.evaluation
        
        session.score_vocabulary = bounded_integer_score(evaluation, "score_vocabulary", minimum=1, maximum=5, default=1)
        session.score_clarity = bounded_integer_score(evaluation, "score_clarity", minimum=1, maximum=5, default=1)
        session.eye_contact_samples = bounded_integer_score(
            evaluation, "eye_contact_samples", minimum=0, maximum=10_000_000, default=0
        )
        eye_contact_score = evaluation.get("eye_contact_score")
        session.score_eye_contact = (
            bounded_integer_score(evaluation, "eye_contact_score", minimum=0, maximum=100, default=0)
            if session.eye_contact_samples > 0 and eye_contact_score is not None
            else None
        )
        session.score_grammar = bounded_integer_score(evaluation, "score_grammar", minimum=1, maximum=5, default=1)
        session.score_courtesy = bounded_integer_score(evaluation, "score_courtesy", minimum=1, maximum=5, default=1)
        session.score_conciseness = bounded_integer_score(evaluation, "score_conciseness", minimum=1, maximum=5, default=1)
        session.feedback_summary = evaluation.get("feedback_summary", "")
        
        # Calculate total score out of 25 (5 criteria * 5 max points).
        total = (
            session.score_vocabulary +
            session.score_clarity +
            session.score_grammar +
            session.score_courtesy +
            session.score_conciseness
        )
        
        session.total_score = float(total)
        # Passing threshold remains approximately two-thirds of the available points.
        session.passed = session.total_score >= 17.0
        
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save evaluation: {e}")

@router.get("/{session_id}", response_model=PostTestInterviewSessionWithMessagesResponse)
def get_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gets details of a specific post-test interview session."""
    session = db.query(PostTestInterviewSession).filter(PostTestInterviewSession.id == session_id, PostTestInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session

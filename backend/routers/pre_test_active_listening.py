import json
import datetime
import logging
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.ai import close_ai_unavailable
from core.deps import get_current_user, get_current_user_ws
from core.scoring import bounded_integer_score
from models.user import User
from models.pre_test_active_listening import PreTestActiveListeningSession, PreTestActiveListeningMessage
from schemas.pre_test_active_listening import PreTestActiveListeningSessionResponse, PreTestActiveListeningSessionWithMessagesResponse, PreTestActiveListeningCompleteRequest
from services.ai_provider import get_ai_provider

router = APIRouter()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You are Professor Maxiel, an AI partner for an 'Active Listening Pairs' exercise.
Your goal is to test the student's active listening skills.

CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT output thoughts.

The backend sends the listening story first. After the student summarizes it, provide constructive feedback on the accuracy of their summary. Mention key details they captured, key details they missed, and whether the summary was concise. Conclude gracefully and instruct them to click 'Complete Exercise'.
"""

ACTIVE_LISTENING_PROMPTS = [
    """
Listen carefully to this workplace update. On Monday morning, the admissions team received a request to prepare orientation kits for one hundred twenty incoming students. The printed schedules were ready, but the campus maps still had the old library entrance marked, so Mara asked Luis to update the maps before lunch. At two o'clock, the team discovered that thirty scholarship forms were missing signatures from the finance office. Instead of delaying all the kits, they placed a yellow note on those thirty folders and packed the remaining ninety. By four thirty, the updated maps arrived, but only eighty reusable water bottles had been delivered. Mara decided that students from the first two orientation groups would receive bottles immediately, while the rest would pick theirs up the next day at the guidance desk. Now summarize the key details, especially the numbers, times, people, and decisions.
""".strip(),
    """
Please listen to these event instructions. A student leadership workshop will begin at eight thirty in the multimedia hall, but participants must arrive by eight fifteen for attendance and seat assignments. Each group should bring one laptop, two printed copies of their action plan, and a backup copy saved on a flash drive. The morning session focuses on problem identification, the lunch break is from twelve to one, and the afternoon session is for presentation practice. If the projector in the multimedia hall is still unavailable, the workshop will move to Room 204, but registration will remain near the main lobby. After the final presentation, group leaders must submit the attendance sheet and revised action plan to Ms. Reyes before leaving. Summarize the schedule, materials, backup location, and final requirements.
""".strip(),
    """
Here is a short story to summarize. During the community reading program, Jonah volunteered to manage book donations while Aira handled student registration. They expected fifty pupils, but seventy-two arrived because a nearby school joined at the last minute. The team had enough storybooks, but only forty-eight activity sheets, so Jonah photocopied twenty-five more while Aira divided the pupils into six smaller groups. The guest reader was delayed by heavy rain, so the volunteers started with a vocabulary game and moved the storytelling activity after the snack break. By the end of the program, every pupil received a book, but only the first sixty received certificates because the printer ran out of ink. Please summarize the important events, problems, numbers, and solutions.
""".strip(),
]


def get_active_listening_prompt(session_id: int) -> str:
    return ACTIVE_LISTENING_PROMPTS[session_id % len(ACTIVE_LISTENING_PROMPTS)]

@router.post("/start", response_model=PreTestActiveListeningSessionResponse)
def start_session(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Starts or resumes the active 'Active Listening Pairs' session."""
    active_session = db.query(PreTestActiveListeningSession).filter(
        PreTestActiveListeningSession.user_id == current_user.id,
        PreTestActiveListeningSession.status == "active",
    ).order_by(PreTestActiveListeningSession.start_time.desc()).first()
    if active_session:
        now = datetime.datetime.utcnow()
        if (now - active_session.start_time).total_seconds() <= 3600:
            return active_session

        active_session.status = "expired"
        active_session.end_time = now
        db.commit()

    session = PreTestActiveListeningSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.get("/", response_model=List[PreTestActiveListeningSessionResponse])
def get_user_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past active listening sessions for the user."""
    sessions = db.query(PreTestActiveListeningSession).filter(PreTestActiveListeningSession.user_id == current_user.id).order_by(PreTestActiveListeningSession.start_time.desc()).all()
    return sessions

@router.websocket("/{session_id}/chat")
async def active_listening_chat_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional streaming for Active Listening exercise."""
    await websocket.accept()

    session = db.query(PreTestActiveListeningSession).filter(PreTestActiveListeningSession.id == session_id, PreTestActiveListeningSession.user_id == current_user.id).first()
    if not session:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session not found.")
        return
        
    if session.status != "active":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=f"Session is already {session.status}.")
        return
        
    time_elapsed = datetime.datetime.utcnow() - session.start_time
    if time_elapsed.total_seconds() > 3600:
        session.status = "expired"
        session.end_time = datetime.datetime.utcnow()
        db.commit()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Time limit exceeded.")
        return

    stored_history = db.query(PreTestActiveListeningMessage).filter(
        PreTestActiveListeningMessage.session_id == session.id
    ).order_by(
        PreTestActiveListeningMessage.timestamp.asc(),
        PreTestActiveListeningMessage.id.asc(),
    ).all()
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend({
        "role": "assistant" if item.role == "ai" else "user",
        "content": item.content,
    } for item in stored_history)
    
    try:
        ai_provider = get_ai_provider()

        async def stream_and_persist_ai_response():
            full_response = ""
            async for content in ai_provider.stream_chat(messages):
                full_response += content
                await websocket.send_json({"text": content})

            completed_response = full_response.strip()
            if not completed_response:
                raise RuntimeError("AI provider returned an empty Active Listening response.")

            ai_message = PreTestActiveListeningMessage(
                session_id=session.id,
                role="ai",
                content=completed_response,
            )
            db.add(ai_message)
            db.commit()
            db.refresh(ai_message)
            stored_history.append(ai_message)
            messages.append({"role": "assistant", "content": completed_response})
            turn_complete = {"type": "turn_complete"}
            if ai_message.id is not None:
                turn_complete["message_id"] = ai_message.id
            await websocket.send_json(turn_complete)

        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    user_text_value = data.get("text")
                    if isinstance(user_text_value, str) and user_text_value.strip():
                        user_text = user_text_value.strip()

                        if user_text == "/start_exercise":
                            if stored_history:
                                latest_message = stored_history[-1]
                                if latest_message.role == "user":
                                    await stream_and_persist_ai_response()
                                else:
                                    await websocket.send_json({
                                        "text": latest_message.content,
                                        "message_id": latest_message.id,
                                    })
                                    await websocket.send_json({
                                        "type": "turn_complete",
                                        "message_id": latest_message.id,
                                    })
                                continue

                            prompt = get_active_listening_prompt(session.id)
                            prompt_message = PreTestActiveListeningMessage(
                                session_id=session.id,
                                role="ai",
                                content=prompt,
                            )
                            db.add(prompt_message)
                            db.commit()
                            db.refresh(prompt_message)
                            stored_history.append(prompt_message)
                            messages.append({"role": "assistant", "content": prompt})
                            await websocket.send_json({"text": prompt, "message_id": prompt_message.id})
                            await websocket.send_json({
                                "type": "turn_complete",
                                "message_id": prompt_message.id,
                            })
                            continue

                        db.refresh(session)
                        if session.status != "active":
                            await websocket.close(
                                code=status.WS_1008_POLICY_VIOLATION,
                                reason=f"Session is already {session.status}.",
                            )
                            return

                        user_message = PreTestActiveListeningMessage(
                            session_id=session.id,
                            role="user",
                            content=user_text,
                        )
                        db.add(user_message)
                        db.commit()
                        db.refresh(user_message)
                        stored_history.append(user_message)
                        messages.append({"role": "user", "content": user_text})
                        await stream_and_persist_ai_response()
                        
                except Exception as error:
                    db.rollback()
                    logger.warning(
                        "Active Listening AI stream failed (session_id=%s, error=%s)",
                        session.id,
                        type(error).__name__,
                    )
                    await close_ai_unavailable(websocket)
                    return
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to connect to AI.")
        except Exception:
            pass

@router.post("/{session_id}/complete", response_model=PreTestActiveListeningSessionResponse)
def complete_session(session_id: int, request: PreTestActiveListeningCompleteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Completes and grades the pre-test active listening session."""
    session = db.query(PreTestActiveListeningSession).filter(PreTestActiveListeningSession.id == session_id, PreTestActiveListeningSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    if session.status == "completed":
        return session
        
    # Build Transcript
    history = db.query(PreTestActiveListeningMessage).filter(
        PreTestActiveListeningMessage.session_id == session.id
    ).order_by(
        PreTestActiveListeningMessage.timestamp.asc(),
        PreTestActiveListeningMessage.id.asc(),
    ).all()
    if not history and request.conversation:
        for item in request.conversation:
            # Avoid saving the hidden trigger
            if item.text.strip() == "/start_exercise":
                item.text = "I am ready. Please share the story or instructions."
            new_msg = PreTestActiveListeningMessage(session_id=session.id, role=item.sender, content=item.text)
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
        # Passing threshold is 20
        session.passed = session.total_score >= 17.0
        
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save evaluation: {e}")

@router.get("/{session_id}", response_model=PreTestActiveListeningSessionWithMessagesResponse)
def get_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gets details of a specific pre-test active listening session."""
    session = db.query(PreTestActiveListeningSession).filter(PreTestActiveListeningSession.id == session_id, PreTestActiveListeningSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session

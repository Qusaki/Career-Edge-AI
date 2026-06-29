import os
import json
import datetime
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
# pyrefly: ignore [missing-import]
from openai import AsyncOpenAI

from database import get_db
from core.deps import get_current_user, get_current_user_ws
from models.user import User
from models.pre_test_active_listening import PreTestActiveListeningSession, PreTestActiveListeningMessage
from schemas.pre_test_active_listening import PreTestActiveListeningSessionResponse, PreTestActiveListeningSessionWithMessagesResponse, PreTestActiveListeningCompleteRequest

router = APIRouter()

SYSTEM_PROMPT = """
You are Professor Maxiel, an AI partner for an 'Active Listening Pairs' exercise.
Your goal is to test the student's active listening skills.

CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT output thoughts.

1. START BY: Sharing a detailed 2 to 3-minute long story or a set of complex instructions. Make it engaging but detailed enough to test their listening comprehension.
2. STOP AND WAIT for the student to reply. The student will summarize what they heard.
3. AFTER the student summarizes, provide constructive feedback on the accuracy of their summary. Did they miss any key details? Were they concise?
4. Conclude the exercise gracefully after your feedback and instruct them to click 'Complete Exercise'.
"""

@router.post("/start", response_model=PreTestActiveListeningSessionResponse)
def start_session(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Creates a new 'Active Listening Pairs' session."""
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
        db.commit()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Time limit exceeded.")
        return

    await websocket.accept()
    
    client = AsyncOpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
    model_name = os.getenv("OLLAMA_MODEL", "llama3.2")
    
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    if data.get("text"):
                        user_text = data["text"]
                        
                        # Handle hidden trigger message from frontend to make AI speak first
                        if user_text.strip() == "/start_exercise":
                            user_text = "I am ready. Please share the story or instructions."
                            
                        messages.append({"role": "user", "content": user_text})
                        
                        response_stream = await client.chat.completions.create(
                            model=model_name,
                            messages=messages,
                            stream=True
                        )
                        
                        full_response = ""
                        sentence_buffer = ""
                        
                        async for chunk in response_stream:
                            if chunk.choices and len(chunk.choices) > 0:
                                content = chunk.choices[0].delta.content
                                if content:
                                    full_response += content
                                    sentence_buffer += content
                                    
                                    await websocket.send_json({"text": content})
                                    
                                    delimiters = ['. ', '! ', '? ', '.\n', '!\n', '?\n', ': ', '; ', ', ', '\n']
                                    for punctuation in delimiters:
                                        if punctuation in sentence_buffer:
                                            parts = sentence_buffer.split(punctuation)
                                            sentence_buffer = punctuation.join(parts[1:])
                                            break
                            
                        messages.append({"role": "assistant", "content": full_response})
                        
                        # Signal turn complete
                        await websocket.send_json({"type": "turn_complete"})
                        
                except Exception as e:
                    print(f"[DEBUG] Error handling text message: {e}")
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to connect to AI.")
        except:
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
    history = db.query(PreTestActiveListeningMessage).filter(PreTestActiveListeningMessage.session_id == session.id).order_by(PreTestActiveListeningMessage.timestamp.asc()).all()
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
        
        session.score_vocabulary = evaluation.get("score_vocabulary", 1)
        session.score_clarity = evaluation.get("score_clarity", 1)
        session.score_eye_contact = evaluation.get("score_eye_contact", 1)
        session.score_grammar = evaluation.get("score_grammar", 1)
        session.score_courtesy = evaluation.get("score_courtesy", 1)
        session.score_conciseness = evaluation.get("score_conciseness", 1)
        session.feedback_summary = evaluation.get("feedback_summary", "")
        
        # Calculate total score out of 30 (6 criteria * 5 max points)
        total = (
            session.score_vocabulary +
            session.score_clarity +
            session.score_eye_contact +
            session.score_grammar +
            session.score_courtesy +
            session.score_conciseness
        )
        
        session.total_score = float(total)
        # Passing threshold is 20
        session.passed = session.total_score >= 20.0
        
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

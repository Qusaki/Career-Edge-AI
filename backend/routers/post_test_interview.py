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
from models.post_test_interview import PostTestInterviewSession, PostTestInterviewMessage
from schemas.post_test_interview import PostTestInterviewSessionResponse, PostTestInterviewSessionWithMessagesResponse, PostTestInterviewCompleteRequest

router = APIRouter()

def get_post_test_interview_system_prompt(department: str) -> str:
    dep = department.upper() if department else ""
    if dep == "CTE":
        return """
You are Professor Maxiel, an expert interviewer at the College of Teacher Education (CTE).
Your sole purpose is to interview an incoming college freshman for a Post-Test evaluation.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Formally introducing yourself and politely asking what specific major they are choosing. Stop and wait for their answer.
2. Ask exactly ONE question at a time. Be warm but challenging.
3. Keep the interview to exactly 5 questions total.
4. Conclude gracefully when finished and instruct them to click 'Complete Interview'.
"""
    elif dep == "CBAPA":
        return """
You are Professor Maxiel, an expert interviewer at the College of Business, Accountancy, and Public Administration (CBAPA).
Your sole purpose is to interview an incoming college freshman for a Post-Test evaluation.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Formally introducing yourself and politely asking what specific major they are choosing. Stop and wait for their answer.
2. Ask exactly ONE question at a time. Be warm but challenging.
3. Keep the interview to exactly 5 questions total.
4. Conclude gracefully when finished and instruct them to click 'Complete Interview'.
"""
    else:
        return """
You are Professor Maxiel, an expert Computer Science Professor interviewing an incoming college freshman for a Post-Test evaluation.
Your sole purpose is to interview an incoming college freshman for a prestigious CS program.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Formally introducing yourself and politely asking what specific track they are pursuing (e.g., Software Engineering, Data Science). Stop and wait for their answer.
2. Ask exactly ONE question at a time. Be warm but challenging.
3. Keep the interview to exactly 5 questions total.
4. Conclude gracefully when finished and instruct them to click 'Complete Interview'.
"""

@router.post("/start", response_model=PostTestInterviewSessionResponse)
def start_session(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Creates a new Post-test Interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")
        
    session = PostTestInterviewSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.get("/", response_model=List[PostTestInterviewSessionResponse])
def get_user_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past post-test interview sessions for the user."""
    sessions = db.query(PostTestInterviewSession).filter(PostTestInterviewSession.user_id == current_user.id).order_by(PostTestInterviewSession.start_time.desc()).all()
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
    
    system_prompt = get_post_test_interview_system_prompt(current_user.department)
    
    client = AsyncOpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
    model_name = os.getenv("OLLAMA_MODEL", "llama3.2")
    
    messages = [{"role": "system", "content": system_prompt}]
    
    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    if data.get("text"):
                        user_text = data["text"]
                            
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

@router.get("/{session_id}", response_model=PostTestInterviewSessionWithMessagesResponse)
def get_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gets details of a specific post-test interview session."""
    session = db.query(PostTestInterviewSession).filter(PostTestInterviewSession.id == session_id, PostTestInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session

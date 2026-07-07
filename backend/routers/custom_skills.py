import json
import datetime
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.ai import close_ai_unavailable, get_ollama_client, get_ollama_model
from core.deps import get_current_user, get_current_user_ws
from models.user import User
from models.custom_skills import CustomSkillsSession, CustomSkillsMessage
from models.post_test_interview import PostTestInterviewSession
from schemas.custom_skills import CustomSkillsSessionResponse, CustomSkillsSessionWithMessagesResponse, CustomSkillsCompleteRequest

router = APIRouter()

def get_weakest_skills(db: Session, user_id: int) -> str:
    """Analyzes past post-test sessions to find the two weakest skills."""
    # Fetch the most recent post-test session
    latest_post_test = db.query(PostTestInterviewSession).filter(
        PostTestInterviewSession.user_id == user_id,
        PostTestInterviewSession.status == "completed"
    ).order_by(PostTestInterviewSession.end_time.desc()).first()
    
    if not latest_post_test:
        return "Vocabulary and Conciseness" # Default if no data
        
    scores = {
        "Vocabulary": latest_post_test.score_vocabulary or 5,
        "Clarity": latest_post_test.score_clarity or 5,
        "Eye Contact": latest_post_test.score_eye_contact or 5,
        "Grammar": latest_post_test.score_grammar or 5,
        "Courtesy": latest_post_test.score_courtesy or 5,
        "Conciseness": latest_post_test.score_conciseness or 5
    }
    
    # Sort by lowest score
    sorted_skills = sorted(scores.items(), key=lambda item: item[1])
    
    # Return top 2 weakest
    weakest_1 = sorted_skills[0][0]
    weakest_2 = sorted_skills[1][0]
    
    return f"{weakest_1} and {weakest_2}"

def get_adaptive_system_prompt(department: str, weak_skills: str) -> str:
    dep = department.upper() if department else "General"
    return f"""
You are an expert AI Career Coach and Interviewer.
The user is a student from the {dep} department.
Based on our system's analysis of their past Pre-test, Post-test, and Drills, this user struggles specifically with: [{weak_skills}].

Your goal is to conduct a highly targeted, interactive practice session to improve these exact weaknesses.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Welcoming them to their personalized Custom Skills Session. Acknowledge that you will be focusing on [{weak_skills}] today.
2. Ask 3 challenging questions or scenarios specifically designed to test [{weak_skills}]. Ask ONE question at a time.
3. Be encouraging but strict on evaluating those weak points.
4. Conclude gracefully when finished and instruct them to click 'Complete Session'.
"""

@router.post("/start", response_model=CustomSkillsSessionResponse)
def start_session(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Starts or resumes the active Custom Skills AI session."""
    active_session = db.query(CustomSkillsSession).filter(
        CustomSkillsSession.user_id == current_user.id,
        CustomSkillsSession.status == "active",
    ).order_by(CustomSkillsSession.start_time.desc()).first()
    if active_session:
        return active_session

    weak_skills = get_weakest_skills(db, current_user.id)
    
    session = CustomSkillsSession(
        user_id=current_user.id,
        targeted_skills=weak_skills
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.get("/", response_model=List[CustomSkillsSessionResponse])
def get_user_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past custom skills sessions for the user."""
    sessions = db.query(CustomSkillsSession).filter(CustomSkillsSession.user_id == current_user.id).order_by(CustomSkillsSession.start_time.desc()).all()
    return sessions

@router.websocket("/{session_id}/chat")
async def custom_skills_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional streaming for the Custom Skills session."""
    session = db.query(CustomSkillsSession).filter(CustomSkillsSession.id == session_id, CustomSkillsSession.user_id == current_user.id).first()
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
    
    system_prompt = get_adaptive_system_prompt(current_user.department, session.targeted_skills)
    
    client = get_ollama_client()
    model_name = get_ollama_model()
    
    messages = [{"role": "system", "content": system_prompt}]
    
    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    if data.get("text"):
                        user_text = data["text"]
                            
                        # Save user msg
                        db_user_msg = CustomSkillsMessage(session_id=session.id, role="user", content=user_text)
                        db.add(db_user_msg)
                        db.commit()
                            
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
                        
                        # Save ai msg
                        db_ai_msg = CustomSkillsMessage(session_id=session.id, role="ai", content=full_response)
                        db.add(db_ai_msg)
                        db.commit()
                        
                        # Signal turn complete
                        await websocket.send_json({"type": "turn_complete"})
                        
                except Exception as e:
                    print(f"[DEBUG] Custom Skills AI error: {e}")
                    await close_ai_unavailable(websocket)
                    return
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to connect to AI.")
        except:
            pass

@router.post("/{session_id}/complete", response_model=CustomSkillsSessionResponse)
def complete_session(session_id: int, request: CustomSkillsCompleteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Completes and grades the custom skills session."""
    session = db.query(CustomSkillsSession).filter(CustomSkillsSession.id == session_id, CustomSkillsSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    if session.status == "completed":
        return session
        
    try:
        session.score = request.score
        session.passed = request.passed
        session.feedback_summary = request.feedback_summary
        
        if request.evaluation_data:
            session.evaluation_data = json.dumps(request.evaluation_data)
        
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save evaluation: {e}")

@router.get("/{session_id}", response_model=CustomSkillsSessionWithMessagesResponse)
def get_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gets details of a specific custom skills session."""
    session = db.query(CustomSkillsSession).filter(CustomSkillsSession.id == session_id, CustomSkillsSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session

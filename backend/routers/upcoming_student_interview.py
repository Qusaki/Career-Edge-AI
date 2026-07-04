import json
import datetime
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.ai import close_ai_unavailable, get_ollama_client, get_ollama_model
from core.deps import get_current_user, get_current_user_ws
from models.user import User
from models.upcoming_student_interview import UpcomingStudentInterviewSession, UpcomingStudentInterviewMessage
from schemas.upcoming_student_interview import UpcomingStudentInterviewSessionResponse, UpcomingStudentInterviewSessionWithMessagesResponse, UpcomingStudentCompleteInterviewRequest

router = APIRouter()



def get_interview_system_prompt(department: str) -> str:
    dep = department.upper() if department else ""
    if dep == "CTE":
        return """
You are Professor Maxiel, an expert interviewer at the College of Teacher Education (CTE).
Your sole purpose is to interview an incoming college freshman.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Formally introducing yourself and politely asking what specific major they are choosing. Stop and wait for their answer.
2. Ask exactly ONE question at a time. Be warm but challenging.
3. Keep the interview to exactly 5 questions total.
4. Conclude gracefully when finished and instruct them to click 'Complete Interview'.
"""
    elif dep == "CBAPA":
        return """
You are Professor Maxiel, an expert interviewer at the College of Business, Accountancy, and Public Administration (CBAPA).
Your sole purpose is to interview an incoming college freshman.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Formally introducing yourself and politely asking what specific major they are choosing. Stop and wait for their answer.
2. Ask exactly ONE question at a time. Be warm but challenging.
3. Keep the interview to exactly 5 questions total.
4. Conclude gracefully when finished and instruct them to click 'Complete Interview'.
"""
    else:
        return """
You are Professor Maxiel, an expert Computer Science Professor interviewing an incoming college freshman.
Your sole purpose is to interview an incoming college freshman for a prestigious CS program.
CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.

1. START BY: Formally introducing yourself and politely asking what specific track they are pursuing (e.g., Software Engineering, Data Science). Stop and wait for their answer.
2. Ask exactly ONE question at a time. Be warm but challenging.
3. Keep the interview to exactly 5 questions total.
4. Conclude gracefully when finished and instruct them to click 'Complete Interview'.
"""

@router.post("/start", response_model=UpcomingStudentInterviewSessionResponse)
def start_interview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Creates a new structured upcoming student interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")
        
    session = UpcomingStudentInterviewSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

from typing import List

@router.get("/", response_model=List[UpcomingStudentInterviewSessionResponse])
def get_user_interviews(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past past upcoming student interview sessions for the authenticated user."""
    sessions = db.query(UpcomingStudentInterviewSession).filter(UpcomingStudentInterviewSession.user_id == current_user.id).order_by(UpcomingStudentInterviewSession.start_time.desc()).all()
    return sessions

@router.websocket("/{session_id}/chat")
async def interview_chat_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional streaming with Local Ollama API."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Forbidden: Department not authorized.")
        return

    # Validate Session & Timer
    session = db.query(UpcomingStudentInterviewSession).filter(UpcomingStudentInterviewSession.id == session_id, UpcomingStudentInterviewSession.user_id == current_user.id).first()
    if not session:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Interview session not found.")
        return
        
    if session.status != "active":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=f"Interview is already {session.status}.")
        return
        
    time_elapsed = datetime.datetime.utcnow() - session.start_time
    if time_elapsed.total_seconds() > 3600: # 1 hour
        session.status = "expired"
        db.commit()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Interview time limit (1 hour) exceeded.")
        return

    await websocket.accept()

    system_prompt = get_interview_system_prompt(current_user.department)
    
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
                        print(f"\\n[DEBUG] Sending to Ollama: '{user_text}'")
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
                    print(f"[DEBUG] Upcoming Student Interview AI error: {e}")
                    await close_ai_unavailable(websocket)
                    return
            elif "bytes" in msg:
                 pass
    except WebSocketDisconnect:
        print("\n[DEBUG] Client disconnected.")
    except Exception as e:
        print(f"WebSocket Error: {e}")
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to connect to AI.")
        except Exception:
            pass

def get_evaluation_system_prompt(department: str) -> str:
    if department and department.upper() == "CTE":
        return """
You are a strict grading algorithm evaluating a transcript of a mock College of Teacher Education (CTE) freshman interview.
You will extract 7 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.
Required JSON keys: subject_matter_score, teaching_aptitude_score, communication_score, motivation_score, academic_preparedness_score, problem_solving_score, leadership_score, feedback_summary.

Weights:
1. Subject Matter Knowledge (25%)
2. Teaching Aptitude & Pedagogy (20%)
3. Communication Skills (20%)
4. Personal Motivation & Values (15%)
5. Academic Preparedness (10%)
6. Problem-Solving & Critical Thinking (5%)
7. Leadership (5%)
"""
    elif department and department.upper() == "CBAPA":
        return """
You are a strict grading algorithm evaluating a transcript of a mock College of Business, Accountancy, and Public Administration (CBAPA) freshman interview.
You will extract 7 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.
Required JSON keys: business_fundamentals_score, analytical_score, communication_score, entrepreneurial_score, academic_preparedness_score, leadership_score, ethical_score, feedback_summary.

Weights:
1. Business Fundamentals & Major Knowledge (25%)
2. Analytical & Problem-Solving Skills (20%)
3. Communication & Professionalism (15%)
4. Entrepreneurial Mindset & Innovation (15%)
5. Academic Preparedness (10%)
6. Leadership & Teamwork Experiences (10%)
7. Ethical Decision-Making (5%)
"""
    else:
        return """
You are a strict grading algorithm evaluating a transcript of a mock computer science freshman interview.
You will extract 5 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.
Required JSON keys: technical_score, problem_solving_score, coding_score, communication_score, soft_skills_score, feedback_summary.

Weights:
1. Technical Fundamentals (30%)
2. Problem-Solving Approach (25%)
3. Coding Basics (20%)
4. Communication & Enthusiasm (15%)
5. Preparation & Soft Skills (10%)
"""

@router.post("/{session_id}/complete", response_model=UpcomingStudentInterviewSessionResponse)
def complete_interview(session_id: int, request: UpcomingStudentCompleteInterviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(UpcomingStudentInterviewSession).filter(UpcomingStudentInterviewSession.id == session_id, UpcomingStudentInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
        
    if session.status == "completed":
        return session
        
    # Build Transcript
    history = db.query(UpcomingStudentInterviewMessage).filter(UpcomingStudentInterviewMessage.session_id == session.id).order_by(UpcomingStudentInterviewMessage.timestamp.asc()).all()
    if history:
        pass
    elif request.conversation:
        for item in request.conversation:
            new_msg = UpcomingStudentInterviewMessage(session_id=session.id, role=item.sender, content=item.text)
            db.add(new_msg)
        db.commit()
    else:
        raise HTTPException(status_code=400, detail="Cannot grade an empty interview.")
    
    if not request.evaluation:
        raise HTTPException(status_code=400, detail="Missing frontend evaluation data.")
        
    try:
        evaluation = request.evaluation
        
        if current_user.department.upper() == "CTE":
            session.score_cte_subject_matter = evaluation.get("subject_matter_score", 0)
            session.score_cte_teaching = evaluation.get("teaching_aptitude_score", 0)
            session.score_cte_communication = evaluation.get("communication_score", 0)
            session.score_cte_motivation = evaluation.get("motivation_score", 0)
            session.score_cte_academic = evaluation.get("academic_preparedness_score", 0)
            session.score_cte_problem_solving = evaluation.get("problem_solving_score", 0)
            session.score_cte_leadership = evaluation.get("leadership_score", 0)
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            total = (
                (session.score_cte_subject_matter * 0.25) +
                (session.score_cte_teaching * 0.20) +
                (session.score_cte_communication * 0.20) +
                (session.score_cte_motivation * 0.15) +
                (session.score_cte_academic * 0.10) +
                (session.score_cte_problem_solving * 0.05) +
                (session.score_cte_leadership * 0.05)
            )
        elif current_user.department.upper() == "CBAPA":
            session.score_cbapa_business = evaluation.get("business_fundamentals_score", 0)
            session.score_cbapa_analytical = evaluation.get("analytical_score", 0)
            session.score_cbapa_communication = evaluation.get("communication_score", 0)
            session.score_cbapa_entrepreneurial = evaluation.get("entrepreneurial_score", 0)
            session.score_cbapa_academic = evaluation.get("academic_preparedness_score", 0)
            session.score_cbapa_leadership = evaluation.get("leadership_score", 0)
            session.score_cbapa_ethical = evaluation.get("ethical_score", 0)
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            total = (
                (session.score_cbapa_business * 0.25) +
                (session.score_cbapa_analytical * 0.20) +
                (session.score_cbapa_communication * 0.15) +
                (session.score_cbapa_entrepreneurial * 0.15) +
                (session.score_cbapa_academic * 0.10) +
                (session.score_cbapa_leadership * 0.10) +
                (session.score_cbapa_ethical * 0.05)
            )
        else:
            session.score_technical = evaluation.get("technical_score", 0)
            session.score_problem_solving = evaluation.get("problem_solving_score", 0)
            session.score_coding = evaluation.get("coding_score", 0)
            session.score_communication = evaluation.get("communication_score", 0)
            session.score_soft_skills = evaluation.get("soft_skills_score", 0)
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            # Calculate weighted total
            total = (
                (session.score_technical * 0.30) +
                (session.score_problem_solving * 0.25) +
                (session.score_coding * 0.20) +
                (session.score_communication * 0.15) +
                (session.score_soft_skills * 0.10)
            )
            
        session.total_score = round(total, 2)
        session.passed = session.total_score >= 70.0
        
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate evaluation: {e}")

@router.get("/{session_id}", response_model=UpcomingStudentInterviewSessionWithMessagesResponse)
def get_interview(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(UpcomingStudentInterviewSession).filter(UpcomingStudentInterviewSession.id == session_id, UpcomingStudentInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return session

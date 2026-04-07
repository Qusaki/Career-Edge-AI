import os
import json
import asyncio
import re
import datetime
from fastapi import APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse
import google.generativeai as genai
from google import genai as new_genai
from google.genai import types
import base64

from database import get_db
from core.deps import get_current_user, get_current_user_ws
from core.tts import generate_tts_base64_async
from models.user import User
from models.interview import InterviewSession, InterviewMessage
from schemas.interview import InterviewSessionResponse, InterviewSessionWithMessagesResponse, InterviewChatRequest

router = APIRouter()

def strip_markdown_for_tts(text: str) -> str:
    text = re.sub(r'[*_]', '', text)
    text = re.sub(r'#+\s', '', text)
    return text.strip()

def get_interview_system_prompt(department: str) -> str:
    dep = department.upper() if department else ""
    if dep == "CTE":
        return """
You are Maxiel, an expert Professor in the College of Teacher Education (CTE) interviewing an incoming college freshman.
Your goal is to assess their teaching aptitude, subject matter knowledge, communication skills, and personal values.

Follow these strict rules:
1. As soon as the interview starts, formally introduce yourself as Professor Maxiel, warmly welcome the student, and politely ask them what specific major or course they are choosing within CTE (e.g., Major in English, Science, Mathematics, Physical Education, etc.). Wait for them to answer before proceeding.
2. Keep the conversation flowing naturally. Ask exactly ONE question at a time based on their chosen major and general teaching aptitude.
3. Wait for the user to answer before moving to the next topic.
4. Be warm and encouraging, but ask challenging follow-up questions to test their critical thinking and readiness for teaching.
5. Limit the interview to exactly 5 to 7 questions total to avoid overwhelming the student. Track the number of questions you ask.
6. You have a maximum duration of 1 hour for the session. Be aware of this time limit.
7. Once you have asked your 5th to 7th question and received their answer, gracefully conclude the interview. Thank them for their time, inform them the session is officially over, and instruct them to click the 'Complete Interview' button to view their scores. Do NOT ask any further questions after concluding.
8. Topics to cover: Subject matter foundation, teaching pedagogy, problem-solving in a classroom setting, and why they want to be a teacher.
"""
    elif dep == "CBAPA":
        return """
You are Maxiel, an expert Professor in the College of Business, Accountancy, and Public Administration (CBAPA) interviewing an incoming college freshman.
Your goal is to assess their business acumen, problem-solving skills, professionalism, and ethical decision-making.

Follow these strict rules:
1. As soon as the interview starts, formally introduce yourself as Professor Maxiel, warmly welcome the student, and politely ask them what specific major or course they are choosing within CBAPA (e.g., Major in Accountancy, Business Administration, Public Administration, etc.). Wait for them to answer before proceeding.
2. Keep the conversation flowing naturally. Ask exactly ONE question at a time based on their chosen major and general business fundamentals.
3. Wait for the user to answer before moving to the next topic.
4. Be warm and encouraging, but ask challenging follow-up questions to test their analytical thinking and entrepreneurial mindset.
5. Limit the interview to exactly 5 to 7 questions total to avoid overwhelming the student. Track the number of questions you ask.
6. You have a maximum duration of 1 hour for the session. Be aware of this time limit.
7. Once you have asked your 5th to 7th question and received their answer, gracefully conclude the interview. Thank them for their time, inform them the session is officially over, and instruct them to click the 'Complete Interview' button to view their scores. Do NOT ask any further questions after concluding.
8. Topics to cover: Business fundamentals, problem-solving in a professional setting, leadership potential, and ethical decision-making.
"""
    else:
        return """
You are Maxiel, an expert Computer Science Professor interviewing an incoming college freshman for a prestigious CS program.
Your goal is to assess their foundational knowledge, problem-solving skills, and enthusiasm for computer science.

Follow these strict rules:
1. As soon as the interview starts, formally introduce yourself as Professor Maxiel, warmly welcome the student to the CCIT department, and politely ask them what specific track or course they are pursuing (e.g., Software Engineering, Data Science, Cybersecurity, Network Engineering, etc.). Wait for them to answer before proceeding.
2. Keep the conversation flowing naturally. Ask exactly ONE question at a time.
3. Wait for the user to answer before moving to the next topic.
4. Be warm and encouraging, but ask challenging follow-up questions to test their critical thinking.
5. Limit the interview to exactly 5 to 7 questions total to avoid overwhelming the student. Track the number of questions you ask.
6. You have a maximum duration of 1 hour for the session. Be aware of this time limit.
7. Once you have asked your 5th to 7th question and received their answer, gracefully conclude the interview. Thank them for their time, inform them the session is officially over, and instruct them to click the 'Complete Interview' button to view their scores. Do NOT ask any further questions after concluding.
8. Topics to cover: Basic technical concepts, logic puzzles, why they want to study CS, and their preparation.
"""

@router.post("/start", response_model=InterviewSessionResponse)
def start_interview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Creates a new interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")
        
    session = InterviewSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.websocket("/{session_id}/chat")
async def interview_chat_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional audio streaming with Gemini Live API."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Forbidden: Department not authorized.")
        return

    # Validate Session & Timer
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id, InterviewSession.user_id == current_user.id).first()
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
    
    # Initialize Google GenAI Client
    api_key = os.environ.get("GEMINI_API_KEY")
    client = new_genai.Client(api_key=api_key)
    
    config = types.LiveConnectConfig(
        response_modalities=[types.LiveResponseModality.AUDIO],
        system_instruction=types.Content(parts=[types.Part.from_text(text=system_prompt)])
    )
    
    try:
        async with client.aio.live.connect(model="gemini-2.0-flash-exp", config=config) as live_session:
            
            async def receive_from_client():
                try:
                    while True:
                        msg = await websocket.receive()
                        if "bytes" in msg:
                            await live_session.send(input={"data": msg["bytes"], "mime_type": "audio/pcm;rate=16000"}, end_of_turn=False)
                        elif "text" in msg:
                            try:
                                data = json.loads(msg["text"])
                                if data.get("type") == "end_of_turn":
                                    await live_session.send(end_of_turn=True)
                            except:
                                pass
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    print(f"Receive from client error: {e}")

            async def send_to_client():
                try:
                    async for response in live_session.receive():
                        server_content = response.server_content
                        if server_content is not None:
                            model_turn = server_content.model_turn
                            if model_turn is not None:
                                for part in model_turn.parts:
                                    if part.text:
                                        await websocket.send_json({"type": "text", "text": part.text})
                                    if part.inline_data:
                                        audio_b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                                        await websocket.send_json({"type": "audio", "audio_b64": audio_b64})
                        
                        if server_content and server_content.turn_complete:
                            await websocket.send_json({"type": "turn_complete"})
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"Send to client error: {e}")

            await asyncio.gather(receive_from_client(), send_to_client())
    except Exception as e:
        print(f"Live API connection failed: {e}")
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to connect to AI.")
        except Exception:
            pass

def get_evaluation_system_prompt(department: str) -> str:
    if department and department.upper() == "CTE":
        return """
You are a strict grading algorithm evaluating a transcript of a mock College of Teacher Education (CTE) freshman interview.
You will extract 7 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.

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

Weights:
1. Technical Fundamentals (30%)
2. Problem-Solving Approach (25%)
3. Coding Basics (20%)
4. Communication & Enthusiasm (15%)
5. Preparation & Soft Skills (10%)
"""

import typing_extensions

class InterviewEvaluation(typing_extensions.TypedDict):
    technical_score: float
    problem_solving_score: float
    coding_score: float
    communication_score: float
    soft_skills_score: float
    feedback_summary: str

class CteInterviewEvaluation(typing_extensions.TypedDict):
    subject_matter_score: float
    teaching_aptitude_score: float
    communication_score: float
    motivation_score: float
    academic_preparedness_score: float
    problem_solving_score: float
    leadership_score: float
    feedback_summary: str

class CbapaInterviewEvaluation(typing_extensions.TypedDict):
    business_fundamentals_score: float
    analytical_score: float
    communication_score: float
    entrepreneurial_score: float
    academic_preparedness_score: float
    leadership_score: float
    ethical_score: float
    feedback_summary: str

@router.post("/{session_id}/complete", response_model=InterviewSessionResponse)
def complete_interview(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(InterviewSession).filter(InterviewSession.id == session_id, InterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
        
    if session.status == "completed":
        return session
        
    # Build Transcript
    history = db.query(InterviewMessage).filter(InterviewMessage.session_id == session.id).order_by(InterviewMessage.timestamp.asc()).all()
    if not history:
        raise HTTPException(status_code=400, detail="Cannot grade an empty interview.")
        
    transcript = "\\n".join([f"{msg.role.upper()}: {msg.content}" for msg in history])
    
    # Send to Gemini with JSON Schema
    system_prompt = get_evaluation_system_prompt(current_user.department)
    if current_user.department.upper() == "CTE":
        schema_to_use = CteInterviewEvaluation
    elif current_user.department.upper() == "CBAPA":
        schema_to_use = CbapaInterviewEvaluation
    else:
        schema_to_use = InterviewEvaluation
        
    model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=system_prompt)
    
    response = model.generate_content(
        f"Evaluate this transcript:\\n\\n{transcript}",
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=schema_to_use
        )
    )
    
    try:
        evaluation = json.loads(response.text)
        
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

@router.get("/{session_id}", response_model=InterviewSessionWithMessagesResponse)
def get_interview(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(InterviewSession).filter(InterviewSession.id == session_id, InterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return session
import os
import json
import asyncio
import re
import datetime
from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse
import google.generativeai as genai

from database import get_db
from core.deps import get_current_user
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
You are an expert Professor in the College of Teacher Education (CTE) interviewing an incoming college freshman.
Your goal is to assess their teaching aptitude, subject matter knowledge, communication skills, and personal values.

Follow these strict rules:
1. As soon as the interview starts, warmly welcome the student and politely ask them what specific major or course they are choosing within CTE (e.g., Major in English, Science, Mathematics, Physical Education, etc.). Wait for them to answer before proceeding.
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
You are an expert Professor in the College of Business, Accountancy, and Public Administration (CBAPA) interviewing an incoming college freshman.
Your goal is to assess their business acumen, problem-solving skills, professionalism, and ethical decision-making.

Follow these strict rules:
1. As soon as the interview starts, warmly welcome the student and politely ask them what specific major or course they are choosing within CBAPA (e.g., Major in Accountancy, Business Administration, Public Administration, etc.). Wait for them to answer before proceeding.
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
You are an expert Computer Science Professor interviewing an incoming college freshman for a prestigious CS program.
Your goal is to assess their foundational knowledge, problem-solving skills, and enthusiasm for computer science.

Follow these strict rules:
1. As soon as the interview starts, warmly welcome the student to the CCIT department and politely ask them what specific track or course they are pursuing (e.g., Software Engineering, Data Science, Cybersecurity, Network Engineering, etc.). Wait for them to answer before proceeding.
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

@router.post("/{session_id}/chat")
async def interview_chat(session_id: int, request: Request, body: InterviewChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Handles chat responses inside the specific interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This interview simulation is only available to CCIT, CTE, and CBAPA students.")

    # 1. Validate Session & Timer
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id, InterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
        
    if session.status != "active":
        raise HTTPException(status_code=400, detail=f"Interview is already {session.status}.")
        
    time_elapsed = datetime.datetime.utcnow() - session.start_time
    if time_elapsed.total_seconds() > 3600: # 1 hour
        session.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="Interview time limit (1 hour) exceeded.")

    # 2. Save User Message
    user_msg = InterviewMessage(session_id=session.id, role="user", content=body.text)
    db.add(user_msg)
    db.commit()

    # 3. Fetch History (Gemini uses 'model' instead of 'ai')
    history = db.query(InterviewMessage).filter(InterviewMessage.session_id == session.id).order_by(InterviewMessage.timestamp.asc()).all()
    system_prompt = get_interview_system_prompt(current_user.department)
    
    messages_payload = []
    for msg in history:
        gemini_role = "model" if msg.role == "ai" else "user"
        messages_payload.append({"role": gemini_role, "parts": [msg.content]})

    async def event_generator():
        queue = asyncio.Queue()
        
        async def process_tts(text_to_speak: str):
            audio_b64 = await generate_tts_base64_async(text_to_speak)
            if audio_b64:
                await queue.put({"event": "audio", "data": json.dumps({"audio_base64": audio_b64})})

        async def process_gemini():
            tts_tasks = []
            full_ai_response = ""
            try:
                # Use gemini-2.5-flash for ultra-low latency & system_instruction for strict adherence
                model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=system_prompt)
                response_stream = await model.generate_content_async(messages_payload, stream=True)
                sentence_buffer = ""

                async for chunk in response_stream:
                    if chunk.text:
                        await queue.put({"event": "text", "data": json.dumps({"text": chunk.text})})
                        full_ai_response += chunk.text
                        sentence_buffer += chunk.text
                        
                        # Aggressive splitting for low latency (especially for the first audio chunk)
                        # We trigger TTS on common punctuation OR a long sentence buffer
                        delimiters = ['. ', '! ', '? ', '.\n', '!\n', '?\n', ': ', '; ', ', ', '\n']
                        for punctuation in delimiters:
                            if punctuation in sentence_buffer:
                                parts = sentence_buffer.split(punctuation)
                                text_to_speak = parts[0] + punctuation[0]
                                sanitized_text = strip_markdown_for_tts(text_to_speak)
                                
                                # Only send if it's substantial (unless it's the very first part)
                                if len(sanitized_text.strip()) > 10 or len(tts_tasks) == 0:
                                    task = asyncio.create_task(process_tts(sanitized_text))
                                    tts_tasks.append(task)
                                    sentence_buffer = punctuation.join(parts[1:])
                                    break
                                
                if sentence_buffer.strip():
                    sanitized_remainder = strip_markdown_for_tts(sentence_buffer)
                    task = asyncio.create_task(process_tts(sanitized_remainder))
                    tts_tasks.append(task)
                    
            except Exception as e:
                await queue.put({"event": "error", "data": json.dumps({"error": str(e)})})
            finally:
                if tts_tasks:
                    await asyncio.gather(*tts_tasks, return_exceptions=True)
                    
                # Save the complete AI response to DB
                if full_ai_response:
                    ai_msg = InterviewMessage(session_id=session.id, role="ai", content=full_ai_response)
                    db.add(ai_msg)
                    db.commit()
                    
                await queue.put(None) 

        producer = asyncio.create_task(process_gemini())
        while True:
            if await request.is_disconnected():
                producer.cancel()
                break
            msg = await queue.get()
            if msg is None:
                break
            yield msg

    return EventSourceResponse(event_generator())

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
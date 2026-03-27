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

INTERVIEW_SYSTEM_PROMPT = """
You are an expert Computer Science Professor interviewing an incoming college freshman for a prestigious CS program.
Your goal is to assess their foundational knowledge, problem-solving skills, and enthusiasm for computer science.

Follow these strict rules:
1. Keep the conversation flowing naturally. Ask exactly ONE question at a time.
2. Wait for the user to answer before moving to the next topic.
3. Be warm and encouraging, but ask challenging follow-up questions to test their critical thinking.
4. Topics to cover: Basic technical concepts, logic puzzles, why they want to study CS, and their preparation.
"""

@router.post("/start", response_model=InterviewSessionResponse)
def start_interview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Creates a new interview session."""
    session = InterviewSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.post("/{session_id}/chat")
async def interview_chat(session_id: int, request: Request, body: InterviewChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Handles chat responses inside the specific interview session."""
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

    # 3. Fetch History
    history = db.query(InterviewMessage).filter(InterviewMessage.session_id == session.id).order_by(InterviewMessage.timestamp.asc()).all()
    
    messages_payload = [{"role": "user", "parts": [INTERVIEW_SYSTEM_PROMPT]}]
    for msg in history:
        # Gemini uses 'model' instead of 'ai'
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
                model = genai.GenerativeModel('gemini-2.5-flash')
                response_stream = await model.generate_content_async(messages_payload, stream=True)
                
                sentence_buffer = ""
                async for chunk in response_stream:
                    if chunk.text:
                        await queue.put({"event": "text", "data": json.dumps({"text": chunk.text})})
                        full_ai_response += chunk.text
                        sentence_buffer += chunk.text
                        
                        for punctuation in ['. ', '! ', '? ', '.\n', '!\n', '?\n']:
                            if punctuation in sentence_buffer:
                                parts = sentence_buffer.split(punctuation)
                                text_to_speak = parts[0] + punctuation[0]
                                sanitized_text = strip_markdown_for_tts(text_to_speak)
                                
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

EVALUATION_SYSTEM_PROMPT = """
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

@router.post("/{session_id}/complete", response_model=InterviewSessionResponse)
def complete_interview(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=EVALUATION_SYSTEM_PROMPT)
    
    response = model.generate_content(
        f"Evaluate this transcript:\\n\\n{transcript}",
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=InterviewEvaluation
        )
    )
    
    try:
        evaluation = json.loads(response.text)
        
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
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id, InterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return session

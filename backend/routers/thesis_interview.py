import os
import json
import asyncio
import re
import datetime
import wave
import io
import base64
from fastapi import APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse
import google.generativeai as genai
from google import genai as new_genai
from google.genai import types

from database import get_db
from core.deps import get_current_user, get_current_user_ws
from core.tts import generate_tts_base64_async
from core.aws import upload_abstract_to_s3, get_abstract_text_from_s3, delete_abstract_from_s3
from models.user import User
from models.thesis_interview import ThesisInterviewSession, ThesisInterviewMessage
from schemas.thesis_interview import ThesisInterviewSessionResponse, ThesisInterviewSessionWithMessagesResponse, ThesisInterviewChatRequest, ThesisCompleteInterviewRequest
from fastapi import UploadFile, File

router = APIRouter()

def strip_markdown_for_tts(text: str) -> str:
    text = re.sub(r'[*_]', '', text)
    text = re.sub(r'#+\s', '', text)
    return text.strip()

def get_thesis_system_prompt(department: str, abstract_text: str = None) -> str:
    dep = department.upper() if department else ""
    base_prompt = """
You are Professor Maxiel. You are acting as a strict but constructive PANEL MEMBER for a formal THESIS DEFENSE.
This session will last for exactly 1 HOUR. You must be aware of the time limits implicitly. Keep track of the fact that this is a comprehensive evaluation requiring deep questioning. Ensure all critical aspects of the thesis are covered within the session so no conversation or evaluation point is missed at the end. Make sure to press the student on weak points.

CRITICAL INSTRUCTION: You MUST speak DIRECTLY to the student. DO NOT narrate your actions. DO NOT explain what you are going to do. DO NOT output thoughts. Just speak exactly what you want the student to hear out loud.
"""
    if abstract_text:
        base_prompt += f"\n\n[STUDENT THESIS ABSTRACT]:\n{abstract_text}\n\nREQUIRED: The student provided this abstract. You MUST use it to ask probing questions tailored strictly to their proposed architecture and methodology.\n"
    if dep == "CTE":
        return base_prompt + """
You are evaluating a College of Teacher Education (CTE) Thesis Defense (BSED / BEEd).
1. START BY: Asking the student to concisely present their pedagogical innovation or action research. Stop and wait for their answer.
2. Ask exactly ONE question at a time. The areas to probe include:
   - Pedagogical Innovation & Classroom Impact
   - Action Research Methodology
   - Learning Outcomes & Student Assessment
   - Literature Review & DepEd Alignment
   - Scalability & Policy Recommendations
3. Conclude gracefully when the comprehensive review is finished or the hour limit is near,.
"""
    elif dep == "CBAPA":
        return base_prompt + """
You are evaluating a College of Business, Accountancy, and Public Administration (CBAPA) Thesis Defense.
1. START BY: Asking the student to state their core research problem and its business relevance. Stop and wait for their answer.
2. Ask exactly ONE question at a time. The areas to probe include:
   - Research Problem & Business Relevance
   - Methodology & Data Analysis
   - Practical Recommendations & Return on Investment (ROI)
   - Literature Review & Theoretical Framework
3. Conclude gracefully when the comprehensive review is finished or the hour limit is near.
"""
    else:
        return base_prompt + """
You are evaluating a BS Computer Science (CCIT) Thesis Defense.
1. START BY: Asking the student to describe their technical innovation or system architecture. Stop and wait for their answer.
2. Ask exactly ONE question at a time. The areas to probe include:
   - Technical Innovation & Algorithm Design
   - System Implementation & Performance metrics
   - Experimental Methodology & Validation
   - Related Work & Literature Review
3. Conclude gracefully when the comprehensive review is finished or the hour limit is near.
"""

@router.post("/start", response_model=ThesisInterviewSessionResponse)
def start_interview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Creates a new thesis interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This defense simulation is only available to CCIT, CTE, and CBAPA students.")
        
    session = ThesisInterviewSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

from typing import List

@router.get("/", response_model=List[ThesisInterviewSessionResponse])
def get_user_interviews(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetches all past thesis interview sessions for the authenticated user."""
    sessions = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.user_id == current_user.id).order_by(ThesisInterviewSession.start_time.desc()).all()
    return sessions

@router.post("/{session_id}/upload-abstract")
def upload_thesis_abstract(session_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.id == session_id, ThesisInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Thesis session not found.")
    if session.status != "active":
        raise HTTPException(status_code=400, detail="Cannot upload to an inactive session.")
    
    try:
        s3_key = upload_abstract_to_s3(file, session_id)
        session.abstract_s3_key = s3_key
        db.commit()
        return {"message": "Abstract uploaded successfully.", "s3_key": s3_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.websocket("/{session_id}/chat")
async def interview_chat_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional audio streaming with Gemini Live API for Thesis Defense."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Forbidden: Department not authorized.")
        return

    # Validate Session & Timer
    session = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.id == session_id, ThesisInterviewSession.user_id == current_user.id).first()
    if not session:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Thesis session not found.")
        return
        
    if session.status != "active":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=f"Thesis session is already {session.status}.")
        return
        
    time_elapsed = datetime.datetime.utcnow() - session.start_time
    if time_elapsed.total_seconds() > 3600: # 1 hour exactly
        session.status = "expired"
        db.commit()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Thesis time limit (1 hour) exceeded.")
        return

    await websocket.accept()

    abstract_text = None
    if session.abstract_s3_key:
        print("[DEBUG] Downloading abstract text for context...")
        abstract_text = get_abstract_text_from_s3(session.abstract_s3_key)

    system_prompt = get_thesis_system_prompt(current_user.department, abstract_text)
    
    # Initialize Google GenAI Client
    api_key = os.environ.get("GEMINI_API_KEY")
    client = new_genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(api_version="v1beta")
    )
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text=system_prompt)])
    )
    
    try:
        async with client.aio.live.connect(model="models/gemini-2.5-flash-native-audio-latest", config=config) as live_session:
            
            audio_chunk_count = 0
            
            async def receive_from_client():
                try:
                    while True:
                        msg = await websocket.receive()
                        if "text" in msg:
                            try:
                                data = json.loads(msg["text"])
                                if data.get("text"):
                                    turn_complete = data.get("end_of_turn", False)
                                    print(f"\n[DEBUG] Sending to Gemini: '{data['text']}' | end_of_turn={turn_complete}")
                                    
                                    await live_session.send(
                                        input=data["text"],
                                        end_of_turn=turn_complete
                                    )
                                    print("[DEBUG] Successfully dispatched to Gemini!")
                                elif data.get("type") == "end_of_turn":
                                    print("\n[DEBUG] Sending manual turn_complete!")
                                    await live_session.send(input="", end_of_turn=True)
                            except Exception as e:
                                print(f"[DEBUG] Error handling text message: {e}")
                except WebSocketDisconnect:
                    print(f"[DEBUG] Client disconnected.")
                except Exception as e:
                    print(f"[DEBUG] Receive from client error: {e}")

            async def send_to_client():
                try:
                    while True:
                        async for response in live_session.receive():
                            server_content = response.server_content
                            if server_content is not None:
                                model_turn = server_content.model_turn
                                if model_turn is not None:
                                    for part in model_turn.parts:
                                        if part.inline_data:
                                            await websocket.send_bytes(part.inline_data.data)
                                        if part.text:
                                            print(f"[DEBUG] Received text chunk from Gemini: {part.text}")
                                            await websocket.send_json({"text": part.text})
                            
                                if server_content.turn_complete:
                                    print("[DEBUG] Received turn_complete from Gemini!")
                                    await websocket.send_json({"type": "turn_complete"})
                                
                                if hasattr(server_content, 'interrupted') and server_content.interrupted:
                                    print("[DEBUG] Gemini turn was INTERRUPTED!")
                            else:
                                # Log any non-content responses (setup, errors, etc.)
                                print(f"[DEBUG] Non-content response from Gemini: {type(response)}")
                        print("[DEBUG] live_session.receive() iterator ended. Restarting...")
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"[DEBUG] Send to client error: {e}")

            await asyncio.gather(receive_from_client(), send_to_client())
    except Exception as e:
        print(f"Live API connection failed: {e}")
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Failed to connect to AI.")
        except Exception:
            pass

def get_thesis_evaluation_system_prompt(department: str) -> str:
    if department and department.upper() == "CTE":
        return """
You are a strict grading algorithm evaluating a transcript of a mock College of Teacher Education (CTE) Thesis Defense.
You will extract 6 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.

Criteria & Weights:
1. Pedagogical Innovation & Classroom Impact (25%)
2. Action Research Methodology (20%)
3. Learning Outcomes & Student Assessment (20%)
4. Literature Review & DepEd Alignment (15%)
5. Presentation & Teaching Demo (10%)
6. Scalability & Policy Recommendations (10%)
"""
    elif department and department.upper() == "CBAPA":
        return """
You are a strict grading algorithm evaluating a transcript of a mock College of Business, Accountancy, and Public Administration (CBAPA) Thesis Defense.
You will extract 5 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.

Criteria & Weights:
1. Research Problem & Business Relevance (25%)
2. Methodology & Data Analysis (25%)
3. Practical Recommendations & ROI (20%)
4. Literature Review & Theoretical Framework (15%)
5. Presentation & Professional Delivery (15%)
"""
    else:
        return """
You are a strict grading algorithm evaluating a transcript of a mock BS Computer Science Thesis Defense.
You will extract 5 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.

Criteria & Weights:
1. Technical Innovation & Algorithm Design (30%)
2. System Implementation & Performance (25%)
3. Experimental Methodology & Validation (20%)
4. Related Work & Literature Review (15%)
5. Demo & Presentation Quality (10%)
"""

import typing_extensions

class ThesisCcitEvaluation(typing_extensions.TypedDict):
    technical_innovation_score: float
    system_implementation_score: float
    experimental_validation_score: float
    literature_review_score: float
    demo_quality_score: float
    feedback_summary: str

class ThesisCteEvaluation(typing_extensions.TypedDict):
    pedagogical_innovation_score: float
    action_research_score: float
    learning_outcomes_score: float
    literature_alignment_score: float
    teaching_demo_score: float
    scalability_policy_score: float
    feedback_summary: str

class ThesisCbapaEvaluation(typing_extensions.TypedDict):
    research_problem_score: float
    methodology_analysis_score: float
    practical_roi_score: float
    literature_theoretical_score: float
    professional_delivery_score: float
    feedback_summary: str

@router.post("/{session_id}/complete", response_model=ThesisInterviewSessionResponse)
def complete_interview(session_id: int, request: ThesisCompleteInterviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.id == session_id, ThesisInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Thesis session not found.")
        
    if session.status == "completed":
        return session
        
    # Build Transcript
    history = db.query(ThesisInterviewMessage).filter(ThesisInterviewMessage.session_id == session.id).order_by(ThesisInterviewMessage.timestamp.asc()).all()
    if history:
        transcript = "\n".join([f"{msg.role.upper()}: {msg.content}" for msg in history])
    elif request.conversation:
        transcript = "\n".join([f"{msg.sender.upper()}: {msg.text}" for msg in request.conversation])
        for item in request.conversation:
            new_msg = ThesisInterviewMessage(session_id=session.id, role=item.sender, content=item.text)
            db.add(new_msg)
        db.commit()
    else:
        raise HTTPException(status_code=400, detail="Cannot grade an empty thesis defense.")
    
    # Send to Gemini with JSON Schema
    system_prompt = get_thesis_evaluation_system_prompt(current_user.department)
    if current_user.department.upper() == "CTE":
        schema_to_use = ThesisCteEvaluation
    elif current_user.department.upper() == "CBAPA":
        schema_to_use = ThesisCbapaEvaluation
    else:
        schema_to_use = ThesisCcitEvaluation
        
    model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=system_prompt)
    
    response = model.generate_content(
        f"Evaluate this transcript:\\n\\n{transcript}",
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=schema_to_use
        )
    )
    
    try:
        if session.abstract_s3_key:
            delete_abstract_from_s3(session.abstract_s3_key)
            session.abstract_s3_key = None # Clear it sequentially so we don't accidentally try to delete it twice
            
        evaluation = json.loads(response.text)
        
        if current_user.department.upper() == "CTE":
            session.score_cte_pedagogical_innovation = evaluation.get("pedagogical_innovation_score", 0)
            session.score_cte_action_research = evaluation.get("action_research_score", 0)
            session.score_cte_learning_outcomes = evaluation.get("learning_outcomes_score", 0)
            session.score_cte_literature_alignment = evaluation.get("literature_alignment_score", 0)
            session.score_cte_teaching_demo = evaluation.get("teaching_demo_score", 0)
            session.score_cte_scalability_policy = evaluation.get("scalability_policy_score", 0)
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            total = (
                (session.score_cte_pedagogical_innovation * 0.25) +
                (session.score_cte_action_research * 0.20) +
                (session.score_cte_learning_outcomes * 0.20) +
                (session.score_cte_literature_alignment * 0.15) +
                (session.score_cte_teaching_demo * 0.10) +
                (session.score_cte_scalability_policy * 0.10)
            )
        elif current_user.department.upper() == "CBAPA":
            session.score_cbapa_research_problem = evaluation.get("research_problem_score", 0)
            session.score_cbapa_methodology_analysis = evaluation.get("methodology_analysis_score", 0)
            session.score_cbapa_practical_roi = evaluation.get("practical_roi_score", 0)
            session.score_cbapa_literature_theoretical = evaluation.get("literature_theoretical_score", 0)
            session.score_cbapa_professional_delivery = evaluation.get("professional_delivery_score", 0)
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            total = (
                (session.score_cbapa_research_problem * 0.25) +
                (session.score_cbapa_methodology_analysis * 0.25) +
                (session.score_cbapa_practical_roi * 0.20) +
                (session.score_cbapa_literature_theoretical * 0.15) +
                (session.score_cbapa_professional_delivery * 0.15)
            )
        else: # CCIT
            session.score_ccit_technical_innovation = evaluation.get("technical_innovation_score", 0)
            session.score_ccit_system_implementation = evaluation.get("system_implementation_score", 0)
            session.score_ccit_experimental_validation = evaluation.get("experimental_validation_score", 0)
            session.score_ccit_literature_review = evaluation.get("literature_review_score", 0)
            session.score_ccit_demo_quality = evaluation.get("demo_quality_score", 0)
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            # Calculate weighted total
            total = (
                (session.score_ccit_technical_innovation * 0.30) +
                (session.score_ccit_system_implementation * 0.25) +
                (session.score_ccit_experimental_validation * 0.20) +
                (session.score_ccit_literature_review * 0.15) +
                (session.score_ccit_demo_quality * 0.10)
            )
            
        session.total_score = round(total, 2)
        session.passed = session.total_score >= 70.0  # Pass threshold
        
        session.status = "completed"
        session.end_time = datetime.datetime.utcnow()
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate evaluation: {e}")

@router.get("/{session_id}", response_model=ThesisInterviewSessionWithMessagesResponse)
def get_interview(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.id == session_id, ThesisInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Thesis session not found.")
    return session

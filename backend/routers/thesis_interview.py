import json
import datetime
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.ai import close_ai_unavailable, get_ollama_client, get_ollama_model
from core.deps import get_current_user, get_current_user_ws
from core.aws import get_abstract_text_from_s3, delete_abstract_from_s3
from models.user import User
from models.thesis_interview import ThesisInterviewSession, ThesisInterviewMessage
from schemas.thesis_interview import ThesisInterviewSessionResponse, ThesisInterviewSessionWithMessagesResponse, ThesisCompleteInterviewRequest

router = APIRouter()



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
3. Conclude gracefully when the comprehensive review is finished or the hour limit is near.
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
    """Starts or resumes the active thesis interview session."""
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This defense simulation is only available to CCIT, CTE, and CBAPA students.")

    active_session = db.query(ThesisInterviewSession).filter(
        ThesisInterviewSession.user_id == current_user.id,
        ThesisInterviewSession.status == "active",
    ).order_by(ThesisInterviewSession.start_time.desc()).first()
    if active_session:
        return active_session

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



@router.websocket("/{session_id}/chat")
async def interview_chat_ws(
    websocket: WebSocket,
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_ws)
):
    """Handles real-time bi-directional streaming with Local Ollama API for Thesis Defense."""
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
                        print(f"\\n[DEBUG] Received from user: '{user_text}'")
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
                    print(f"[DEBUG] Thesis Interview AI error: {e}")
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


def get_thesis_evaluation_system_prompt(department: str) -> str:
    if department and department.upper() == "CTE":
        return """
You are a strict grading algorithm evaluating a transcript of a mock College of Teacher Education (CTE) Thesis Defense.
You will extract 6 scores out of 100 based on the provided rubric. You must respond in STRICT JSON matching the schema.
Required JSON keys: pedagogical_innovation_score, action_research_score, learning_outcomes_score, literature_alignment_score, teaching_demo_score, scalability_policy_score, feedback_summary.

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
Required JSON keys: research_problem_score, methodology_analysis_score, practical_roi_score, literature_theoretical_score, professional_delivery_score, feedback_summary.

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
Required JSON keys: technical_innovation_score, system_implementation_score, experimental_validation_score, literature_review_score, demo_quality_score, feedback_summary.

Criteria & Weights:
1. Technical Innovation & Algorithm Design (30%)
2. System Implementation & Performance (25%)
3. Experimental Methodology & Validation (20%)
4. Related Work & Literature Review (15%)
5. Demo & Presentation Quality (10%)
"""

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
        pass
    elif request.conversation:
        for item in request.conversation:
            new_msg = ThesisInterviewMessage(session_id=session.id, role=item.sender, content=item.text)
            db.add(new_msg)
        db.commit()
    else:
        raise HTTPException(status_code=400, detail="Cannot grade an empty thesis defense.")
    
    if not request.evaluation:
        raise HTTPException(status_code=400, detail="Missing frontend evaluation data.")
        
    try:
        if session.abstract_s3_key:
            delete_abstract_from_s3(session.abstract_s3_key)
            session.abstract_s3_key = None
            
        evaluation = request.evaluation
        session.eye_contact_samples = max(0, int(evaluation.get("eye_contact_samples", 0)))
        eye_contact_score = evaluation.get("eye_contact_score")
        session.score_eye_contact = (
            max(0.0, min(100.0, float(eye_contact_score)))
            if session.eye_contact_samples > 0 and eye_contact_score is not None
            else None
        )
        
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

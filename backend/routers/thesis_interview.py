import json
import datetime
import logging
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from database import get_db
from core.ai import get_ai_unavailable_message
from core.deps import get_current_user, get_current_user_ws
from core.scoring import bounded_integer_score, bounded_score
from core.aws import get_abstract_text_from_s3, delete_abstract_from_s3
from models.user import User
from models.thesis_interview import ThesisInterviewSession, ThesisInterviewMessage
from schemas.thesis_interview import ThesisInterviewSessionResponse, ThesisInterviewSessionWithMessagesResponse, ThesisCompleteInterviewRequest
from services.ai_provider import get_ai_provider
from services.interview_ai import collect_ai_response, parse_evaluation_response, transcript_text

router = APIRouter()
logger = logging.getLogger(__name__)

THESIS_FINAL_TURN_INSTRUCTION = (
    "The student has submitted their fifth and final response. Do not ask another "
    "question. Give one brief constructive closing statement and tell the student "
    "they can complete the defense."
)


def get_thesis_evaluation_score_keys(department: str) -> list[str]:
    dep = department.upper() if department else ""
    if dep == "CTE":
        return [
            "pedagogical_innovation_score", "action_research_score",
            "learning_outcomes_score", "literature_alignment_score",
            "teaching_demo_score", "scalability_policy_score",
        ]
    if dep == "CBAPA":
        return [
            "research_problem_score", "methodology_analysis_score", "practical_roi_score",
            "literature_theoretical_score", "professional_delivery_score",
        ]
    return [
        "technical_innovation_score", "system_implementation_score",
        "experimental_validation_score", "literature_review_score", "demo_quality_score",
    ]


def get_stored_chat_messages(db: Session, session_id: int) -> list[dict[str, str]]:
    history = db.query(ThesisInterviewMessage).filter(
        ThesisInterviewMessage.session_id == session_id
    ).order_by(ThesisInterviewMessage.timestamp.asc()).all()
    return [
        {
            "role": "assistant" if message.role in {"ai", "assistant"} else "user",
            "content": message.content,
        }
        for message in history
    ]



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
    """Handles real-time bi-directional streaming for Thesis Defense."""
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

    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    message_type = data.get("type", "message")
                    stored_messages = get_stored_chat_messages(db, session.id)
                    if message_type == "start" and stored_messages:
                        await websocket.send_json({"type": "history", "messages": stored_messages})
                        if stored_messages[-1]["role"] == "assistant":
                            await websocket.send_json({"type": "session_ready"})
                            continue
                    browser_abstract = str(data.get("abstract_text", "")).strip()[:5000]
                    abstract_text = browser_abstract or None
                    if abstract_text is None and session.abstract_s3_key:
                        abstract_text = get_abstract_text_from_s3(session.abstract_s3_key)
                    system_prompt = get_thesis_system_prompt(current_user.department, abstract_text)
                    is_initial_turn = message_type in {"start", "retry"} and not stored_messages
                    is_retry = message_type == "retry" or (
                        message_type == "start" and bool(stored_messages)
                    )

                    retry_text = str(data.get("text", "")).strip()
                    if (
                        is_retry and stored_messages and
                        stored_messages[-1]["role"] == "assistant" and not retry_text
                    ):
                        await websocket.send_json({"text": stored_messages[-1]["content"]})
                        await websocket.send_json({"type": "turn_complete"})
                        continue

                    if is_initial_turn:
                        provider_messages = [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": "Begin the thesis defense now."},
                        ]
                    elif is_retry and stored_messages and stored_messages[-1]["role"] == "user":
                        effective_prompt = system_prompt
                        if sum(message["role"] == "user" for message in stored_messages) >= 5:
                            effective_prompt = f"{system_prompt}\n\n{THESIS_FINAL_TURN_INSTRUCTION}"
                        provider_messages = [{"role": "system", "content": effective_prompt}, *stored_messages]
                    elif message_type in {"message", "retry"} and str(data.get("text", "")).strip():
                        user_text = str(data["text"]).strip()
                        db.add(ThesisInterviewMessage(
                            session_id=session.id, role="user", content=user_text
                        ))
                        db.commit()
                        stored_messages.append({"role": "user", "content": user_text})
                        effective_prompt = system_prompt
                        if data.get("final_turn") is True:
                            effective_prompt = f"{system_prompt}\n\n{THESIS_FINAL_TURN_INSTRUCTION}"
                        provider_messages = [{"role": "system", "content": effective_prompt}, *stored_messages]
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "No thesis response was provided.",
                            "retryable": True,
                        })
                        continue

                    full_response = ""
                    ai_provider = get_ai_provider()
                    async for content in ai_provider.stream_chat(
                        provider_messages, workload="thesis_interview"
                    ):
                        full_response += content
                        await websocket.send_json({"text": content})

                    full_response = full_response.strip()
                    if not full_response:
                        raise ValueError("Empty AI response")
                    db.add(ThesisInterviewMessage(
                        session_id=session.id, role="ai", content=full_response
                    ))
                    db.commit()
                    await websocket.send_json({"type": "turn_complete"})
                except Exception as error:
                    logger.warning(
                        "Thesis AI stream failed (session_id=%s, error=%s)",
                        session.id,
                        type(error).__name__,
                    )
                    db.rollback()
                    await websocket.send_json({
                        "type": "error",
                        "message": get_ai_unavailable_message(),
                        "retryable": True,
                    })
            elif "bytes" in msg:
                 pass
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.warning(
            "Thesis WebSocket failed (session_id=%s, error=%s)",
            session.id,
            type(error).__name__,
        )
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
async def complete_interview(session_id: int, request: ThesisCompleteInterviewRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.id == session_id, ThesisInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Thesis session not found.")
        
    if session.status == "completed":
        return session
        
    # Build Transcript
    history = db.query(ThesisInterviewMessage).filter(ThesisInterviewMessage.session_id == session.id).order_by(ThesisInterviewMessage.timestamp.asc()).all()
    if not history and request.conversation:
        for item in request.conversation:
            new_msg = ThesisInterviewMessage(session_id=session.id, role=item.sender, content=item.text)
            db.add(new_msg)
        db.commit()
        history = db.query(ThesisInterviewMessage).filter(
            ThesisInterviewMessage.session_id == session.id
        ).order_by(ThesisInterviewMessage.timestamp.asc()).all()
    if not history:
        raise HTTPException(status_code=400, detail="Cannot grade an empty thesis defense.")

    try:
        provider = get_ai_provider()
        transcript = transcript_text(history)
        response = await collect_ai_response(
            provider,
            [
                {"role": "system", "content": get_thesis_evaluation_system_prompt(current_user.department)},
                {
                    "role": "user",
                    "content": (
                        "Evaluate this completed thesis-defense transcript. Return only the "
                        f"required JSON object.\n\n{transcript}"
                    ),
                },
            ],
            workload="thesis_evaluation",
        )
        evaluation = parse_evaluation_response(
            response, get_thesis_evaluation_score_keys(current_user.department)
        )
        client_metrics = request.evaluation or {}
        def score(key: str) -> float:
            return bounded_score(evaluation, key, minimum=0, maximum=100, default=0)

        session.eye_contact_samples = bounded_integer_score(
            client_metrics, "eye_contact_samples", minimum=0, maximum=10_000_000, default=0
        )
        eye_contact_score = client_metrics.get("eye_contact_score")
        session.score_eye_contact = (
            bounded_score(client_metrics, "eye_contact_score", minimum=0, maximum=100, default=0)
            if session.eye_contact_samples > 0 and eye_contact_score is not None
            else None
        )
        
        if current_user.department.upper() == "CTE":
            session.score_cte_pedagogical_innovation = score("pedagogical_innovation_score")
            session.score_cte_action_research = score("action_research_score")
            session.score_cte_learning_outcomes = score("learning_outcomes_score")
            session.score_cte_literature_alignment = score("literature_alignment_score")
            session.score_cte_teaching_demo = score("teaching_demo_score")
            session.score_cte_scalability_policy = score("scalability_policy_score")
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
            session.score_cbapa_research_problem = score("research_problem_score")
            session.score_cbapa_methodology_analysis = score("methodology_analysis_score")
            session.score_cbapa_practical_roi = score("practical_roi_score")
            session.score_cbapa_literature_theoretical = score("literature_theoretical_score")
            session.score_cbapa_professional_delivery = score("professional_delivery_score")
            session.feedback_summary = evaluation.get("feedback_summary", "")
            
            total = (
                (session.score_cbapa_research_problem * 0.25) +
                (session.score_cbapa_methodology_analysis * 0.25) +
                (session.score_cbapa_practical_roi * 0.20) +
                (session.score_cbapa_literature_theoretical * 0.15) +
                (session.score_cbapa_professional_delivery * 0.15)
            )
        else: # CCIT
            session.score_ccit_technical_innovation = score("technical_innovation_score")
            session.score_ccit_system_implementation = score("system_implementation_score")
            session.score_ccit_experimental_validation = score("experimental_validation_score")
            session.score_ccit_literature_review = score("literature_review_score")
            session.score_ccit_demo_quality = score("demo_quality_score")
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
        if session.abstract_s3_key:
            delete_abstract_from_s3(session.abstract_s3_key)
            session.abstract_s3_key = None
        db.commit()
        db.refresh(session)
        
        return session
    except Exception as error:
        db.rollback()
        logger.warning(
            "Thesis evaluation failed (session_id=%s, error=%s)",
            session.id,
            type(error).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="The AI service is temporarily unavailable. Please try validation again.",
        ) from error

@router.get("/{session_id}", response_model=ThesisInterviewSessionWithMessagesResponse)
def get_interview(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not current_user.department or current_user.department.upper() not in ["CCIT", "CTE", "CBAPA"]:
        raise HTTPException(status_code=403, detail="Forbidden: This simulation is only available to CCIT, CTE, and CBAPA students.")

    session = db.query(ThesisInterviewSession).filter(ThesisInterviewSession.id == session_id, ThesisInterviewSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Thesis session not found.")
    return session

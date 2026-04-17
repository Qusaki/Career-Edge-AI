from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class UpcomingStudentInterviewMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class UpcomingStudentInterviewSessionResponse(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    score_technical: Optional[float] = None
    score_problem_solving: Optional[float] = None
    score_coding: Optional[float] = None
    score_communication: Optional[float] = None
    score_soft_skills: Optional[float] = None
    
    # CTE Scores
    score_cte_subject_matter: Optional[float] = None
    score_cte_teaching: Optional[float] = None
    score_cte_communication: Optional[float] = None
    score_cte_motivation: Optional[float] = None
    score_cte_academic: Optional[float] = None
    score_cte_problem_solving: Optional[float] = None
    score_cte_leadership: Optional[float] = None

    # CBAPA Scores
    score_cbapa_business: Optional[float] = None
    score_cbapa_analytical: Optional[float] = None
    score_cbapa_communication: Optional[float] = None
    score_cbapa_entrepreneurial: Optional[float] = None
    score_cbapa_academic: Optional[float] = None
    score_cbapa_leadership: Optional[float] = None
    score_cbapa_ethical: Optional[float] = None

    total_score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None

    class Config:
        from_attributes = True

class UpcomingStudentInterviewSessionWithMessagesResponse(UpcomingStudentInterviewSessionResponse):
    messages: List[UpcomingStudentInterviewMessageResponse] = []

class UpcomingStudentInterviewChatRequest(BaseModel):
    text: str

class UpcomingStudentConversationSpeaker(BaseModel):
    sender: str
    text: str

class UpcomingStudentCompleteInterviewRequest(BaseModel):
    conversation: List[UpcomingStudentConversationSpeaker] = []

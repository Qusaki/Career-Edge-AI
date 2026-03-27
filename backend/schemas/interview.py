from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class InterviewMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class InterviewSessionResponse(BaseModel):
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
    total_score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None

    class Config:
        from_attributes = True

class InterviewSessionWithMessagesResponse(InterviewSessionResponse):
    messages: List[InterviewMessageResponse] = []

class InterviewChatRequest(BaseModel):
    text: str

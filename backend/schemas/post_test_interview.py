# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class PostTestInterviewMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class PostTestInterviewSessionResponse(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    
    score_vocabulary: Optional[int] = None
    score_clarity: Optional[int] = None
    score_eye_contact: Optional[int] = None
    eye_contact_samples: Optional[int] = None
    score_grammar: Optional[int] = None
    score_courtesy: Optional[int] = None
    score_conciseness: Optional[int] = None
    
    total_score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    question_number: int = 1
    answered_questions: int = 0

    class Config:
        from_attributes = True

class PostTestInterviewSessionWithMessagesResponse(PostTestInterviewSessionResponse):
    messages: List[PostTestInterviewMessageResponse] = []

class PostTestInterviewConversationSpeaker(BaseModel):
    sender: str
    text: str

class PostTestInterviewCompleteRequest(BaseModel):
    conversation: List[PostTestInterviewConversationSpeaker] = []
    evaluation: dict

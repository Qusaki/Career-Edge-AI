from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class PreTestActiveListeningMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class PreTestActiveListeningSessionResponse(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    
    score_vocabulary: Optional[int] = None
    score_clarity: Optional[int] = None
    score_eye_contact: Optional[int] = None
    score_grammar: Optional[int] = None
    score_courtesy: Optional[int] = None
    score_conciseness: Optional[int] = None
    
    total_score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None

    class Config:
        from_attributes = True

class PreTestActiveListeningSessionWithMessagesResponse(PreTestActiveListeningSessionResponse):
    messages: List[PreTestActiveListeningMessageResponse] = []

class PreTestActiveListeningConversationSpeaker(BaseModel):
    sender: str
    text: str

class PreTestActiveListeningCompleteRequest(BaseModel):
    conversation: List[PreTestActiveListeningConversationSpeaker] = []
    evaluation: dict

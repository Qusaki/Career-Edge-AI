# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class CustomSkillsMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class CustomSkillsSessionResponse(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    targeted_skills: Optional[str] = None
    
    score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    evaluation_data: Optional[str] = None

    class Config:
        from_attributes = True

class CustomSkillsSessionWithMessagesResponse(CustomSkillsSessionResponse):
    messages: List[CustomSkillsMessageResponse] = []

class CustomSkillsCompleteRequest(BaseModel):
    score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    evaluation_data: Optional[dict] = None

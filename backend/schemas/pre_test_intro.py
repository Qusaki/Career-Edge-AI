# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class PreTestIntroSessionResponse(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    
    score_clarity: Optional[int] = None
    score_completeness: Optional[int] = None
    score_courtesy: Optional[int] = None
    score_correctness: Optional[int] = None
    score_conciseness: Optional[int] = None
    score_eye_contact: Optional[int] = None
    eye_contact_samples: Optional[int] = None
    
    total_score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    transcript: Optional[str] = None

    class Config:
        from_attributes = True

class PreTestIntroCompleteRequest(BaseModel):
    transcript: Optional[str] = None
    evaluation: dict

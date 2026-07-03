# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime

class DrillSessionResponse(BaseModel):
    id: int
    user_id: int
    drill_level: str
    drill_type: str
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    
    score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    evaluation_data: Optional[str] = None

    class Config:
        from_attributes = True

class DrillStartRequest(BaseModel):
    drill_level: str
    drill_type: str

class DrillCompleteRequest(BaseModel):
    score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    evaluation_data: Optional[dict] = None

class NegotiationTurnRequest(BaseModel):
    user_message: str
    turn_number: int
    current_offer: int

# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Dict, List, Optional, Union
from datetime import datetime

DrillPromptValue = Union[str, int, List[str]]
DrillPrompt = Dict[str, DrillPromptValue]

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
    canonical_prompt: Optional[DrillPrompt] = None
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

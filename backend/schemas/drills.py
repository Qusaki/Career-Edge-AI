# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
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
    score_eye_contact: Optional[float] = None
    eye_contact_samples: Optional[int] = None
    canonical_prompt: Optional[DrillPrompt] = None
    evaluation_data: Optional[str] = None

    class Config:
        from_attributes = True

class DrillStartRequest(BaseModel):
    drill_level: str
    drill_type: str


class DrillTypeProgress(BaseModel):
    type: str
    completed: bool
    unlocked: bool
    prerequisite_type: Optional[str] = None


class DrillLevelProgress(BaseModel):
    unlocked: bool
    completed: int = Field(ge=0)
    total: int = Field(ge=0)
    completed_types: List[str]
    drills: List[DrillTypeProgress]


class DrillProgressResponse(BaseModel):
    easy: DrillLevelProgress
    medium: DrillLevelProgress
    hard: DrillLevelProgress

class DrillCompleteRequest(BaseModel):
    score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None
    evaluation_data: Optional[dict] = None
    eye_contact_score: Optional[float] = Field(default=None, ge=0, le=100)
    eye_contact_samples: Optional[int] = Field(default=None, ge=0, le=1_000_000)

class NegotiationTurnRequest(BaseModel):
    user_message: str
    turn_number: int
    current_offer: int

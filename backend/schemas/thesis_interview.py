from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ThesisInterviewMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class ThesisInterviewSessionResponse(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str
    
    # CCIT Scores
    score_ccit_technical_innovation: Optional[float] = None
    score_ccit_system_implementation: Optional[float] = None
    score_ccit_experimental_validation: Optional[float] = None
    score_ccit_literature_review: Optional[float] = None
    score_ccit_demo_quality: Optional[float] = None
    
    # CTE Scores
    score_cte_pedagogical_innovation: Optional[float] = None
    score_cte_action_research: Optional[float] = None
    score_cte_learning_outcomes: Optional[float] = None
    score_cte_literature_alignment: Optional[float] = None
    score_cte_teaching_demo: Optional[float] = None
    score_cte_scalability_policy: Optional[float] = None

    # CBAPA Scores
    score_cbapa_research_problem: Optional[float] = None
    score_cbapa_methodology_analysis: Optional[float] = None
    score_cbapa_practical_roi: Optional[float] = None
    score_cbapa_literature_theoretical: Optional[float] = None
    score_cbapa_professional_delivery: Optional[float] = None

    total_score: Optional[float] = None
    passed: Optional[bool] = None
    feedback_summary: Optional[str] = None

    class Config:
        from_attributes = True

class ThesisInterviewSessionWithMessagesResponse(ThesisInterviewSessionResponse):
    messages: List[ThesisInterviewMessageResponse] = []

class ThesisInterviewChatRequest(BaseModel):
    text: str

class ThesisConversationSpeaker(BaseModel):
    sender: str
    text: str

class ThesisCompleteInterviewRequest(BaseModel):
    conversation: List[ThesisConversationSpeaker] = []

# pyrefly: ignore [missing-import]
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Literal
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

class PostTestCommunicationCriteria(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vocabulary: int
    clarity: int
    grammar: int
    courtesy: int
    conciseness: int

class PostTestQuestionEvaluationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_index: int
    criteria: PostTestCommunicationCriteria
    answer_relevance: int
    learning_evidence: int
    feedback: Optional[str]
    scoring_authority: Literal["semantic_ai_with_objective_caps", "deterministic_fallback"]

class PostTestEvaluationDataResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["post-test-evaluation-v2"]
    question_pack_version: str
    scoring_authority: Literal["semantic_ai_with_objective_caps", "deterministic_fallback"]
    question_evaluations: List[PostTestQuestionEvaluationResponse]
    aggregate_criteria: PostTestCommunicationCriteria
    total_score: int
    passed: bool
    overall_feedback: str
    recommendations: List[str]

class PostTestInterviewSessionWithMessagesResponse(PostTestInterviewSessionResponse):
    messages: List[PostTestInterviewMessageResponse] = []
    evaluation_data: Optional[PostTestEvaluationDataResponse] = None

class PostTestInterviewCompletionResponse(PostTestInterviewSessionResponse):
    evaluation_data: Optional[PostTestEvaluationDataResponse] = None

class PostTestInterviewConversationSpeaker(BaseModel):
    sender: str
    text: str

class PostTestInterviewCompleteRequest(BaseModel):
    conversation: List[PostTestInterviewConversationSpeaker] = []
    evaluation: dict

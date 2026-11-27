from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AdaptiveStartRequest(BaseModel):
    client_attempt_id: UUID


class AdaptiveCompleteRequest(BaseModel):
    response_text: str = Field(min_length=1, max_length=8000)


class AdaptiveSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_criterion: str
    difficulty: str
    scenario_category: str | None
    scenario: str | None
    prompt: str | None
    generation_authority: str | None
    status: str
    response_text: str | None
    score_vocabulary: float | None
    score_clarity: float | None
    score_grammar: float | None
    score_conciseness: float | None
    score_task_completion: float | None
    score_courtesy: float | None
    score_total: float | None
    passed: bool | None
    feedback_summary: str | None
    scoring_authority: str | None
    started_at: datetime
    completed_at: datetime | None


class AdaptiveHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_criterion: str
    difficulty: str
    status: str
    generation_authority: str | None
    scoring_authority: str | None
    score_total: float | None
    passed: bool | None
    feedback_summary: str | None
    started_at: datetime
    completed_at: datetime | None


class AdaptiveCompleteResponse(BaseModel):
    session: AdaptiveSessionResponse
    next_recommendation: dict

"""User-owned generated communication practice, separate from canonical Drills."""

import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint

from database import Base


class AdaptivePracticeSession(Base):
    __tablename__ = "adaptive_practice_sessions"
    __table_args__ = (UniqueConstraint("user_id", "client_attempt_id", name="uq_adaptive_practice_owner_attempt"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_attempt_id = Column(String(128), nullable=False)
    target_criterion = Column(String(32), nullable=False)
    difficulty = Column(String(16), nullable=False)
    department = Column(String(16), nullable=True)
    scenario_category = Column(String(64), nullable=True)
    scenario = Column(Text, nullable=True)
    prompt = Column(Text, nullable=True)
    prompt_fingerprint = Column(String(64), nullable=True)
    generation_authority = Column(String(32), nullable=True)
    generation_version = Column(String(64), nullable=False)
    status = Column(String(24), nullable=False, default="generating")
    response_text = Column(Text, nullable=True)
    score_vocabulary = Column(Float, nullable=True)
    score_clarity = Column(Float, nullable=True)
    score_grammar = Column(Float, nullable=True)
    score_conciseness = Column(Float, nullable=True)
    score_task_completion = Column(Float, nullable=True)
    score_courtesy = Column(Float, nullable=True)
    score_total = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(Text, nullable=True)
    scoring_authority = Column(String(64), nullable=True)
    evaluation_version = Column(String(64), nullable=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

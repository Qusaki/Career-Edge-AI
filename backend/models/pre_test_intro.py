# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from database import Base
import datetime

class PreTestIntroSession(Base):
    __tablename__ = "pre_test_intro_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    start_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # active, completed
    
    # Grading criteria (Beginning 1, Developing 2, Proficient 3)
    score_clarity = Column(Integer, nullable=True)
    score_completeness = Column(Integer, nullable=True)
    score_courtesy = Column(Integer, nullable=True)
    score_correctness = Column(Integer, nullable=True)
    score_conciseness = Column(Integer, nullable=True)
    score_eye_contact = Column(Integer, nullable=True)
    
    total_score = Column(Float, nullable=True) # out of 15
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(String, nullable=True)
    transcript = Column(String, nullable=True)

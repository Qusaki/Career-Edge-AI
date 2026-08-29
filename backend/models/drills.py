# pyrefly: ignore [missing-import]
from sqlalchemy import JSON, Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from database import Base
import datetime

class DrillSession(Base):
    __tablename__ = "drill_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    drill_level = Column(String, nullable=False) # e.g., "easy", "medium", "hard"
    drill_type = Column(String, nullable=False) # e.g., "jam", "fast_word", "emotion", "synonym", "fake_profile", "emoji_story"
    
    start_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # active, completed
    
    score = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(String, nullable=True)
    canonical_prompt = Column(JSON, nullable=True)
    
    # Store any flexible JSON evaluation data as string
    evaluation_data = Column(String, nullable=True)

# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from database import Base
import datetime

class CustomSkillsSession(Base):
    __tablename__ = "custom_skills_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    start_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # active, completed
    
    # Store the dynamically identified weak skills (e.g., "Vocabulary, Clarity")
    targeted_skills = Column(String, nullable=True)
    
    score = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(String, nullable=True)
    
    # Store any flexible JSON evaluation data
    evaluation_data = Column(String, nullable=True)
    
    messages = relationship("CustomSkillsMessage", back_populates="session", cascade="all, delete-orphan")


class CustomSkillsMessage(Base):
    __tablename__ = "custom_skills_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("custom_skills_sessions.id"), nullable=False)
    
    role = Column(String, nullable=False) # 'user' or 'ai'
    content = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    
    session = relationship("CustomSkillsSession", back_populates="messages")

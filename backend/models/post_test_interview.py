# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from database import Base
import datetime

class PostTestInterviewSession(Base):
    __tablename__ = "post_test_interview_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    start_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # active, completed, expired
    
    # Grading criteria (1-5 Scale)
    score_vocabulary = Column(Integer, nullable=True)
    score_clarity = Column(Integer, nullable=True)
    score_eye_contact = Column(Integer, nullable=True)
    score_grammar = Column(Integer, nullable=True)
    score_courtesy = Column(Integer, nullable=True)
    score_conciseness = Column(Integer, nullable=True)
    
    total_score = Column(Float, nullable=True) # out of 25
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(String, nullable=True)
    
    messages = relationship("PostTestInterviewMessage", back_populates="session", cascade="all, delete-orphan")


class PostTestInterviewMessage(Base):
    __tablename__ = "post_test_interview_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("post_test_interview_sessions.id"), nullable=False)
    
    role = Column(String, nullable=False) # 'user' or 'ai'
    content = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    
    session = relationship("PostTestInterviewSession", back_populates="messages")

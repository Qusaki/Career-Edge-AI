from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from database import Base
import datetime

class ThesisInterviewSession(Base):
    __tablename__ = "thesis_interview_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    start_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # active, completed, expired
    
    # CCIT Grading criteria (0.0 to 100.0)
    score_ccit_technical_innovation = Column(Float, nullable=True)   # 30%
    score_ccit_system_implementation = Column(Float, nullable=True)  # 25%
    score_ccit_experimental_validation = Column(Float, nullable=True)# 20%
    score_ccit_literature_review = Column(Float, nullable=True)      # 15%
    score_ccit_demo_quality = Column(Float, nullable=True)           # 10%
    
    # CTE Grading criteria (0.0 to 100.0)
    score_cte_pedagogical_innovation = Column(Float, nullable=True)  # 25%
    score_cte_action_research = Column(Float, nullable=True)         # 20%
    score_cte_learning_outcomes = Column(Float, nullable=True)       # 20%
    score_cte_literature_alignment = Column(Float, nullable=True)    # 15%
    score_cte_teaching_demo = Column(Float, nullable=True)           # 10%
    score_cte_scalability_policy = Column(Float, nullable=True)      # 10%
    
    # CBAPA Grading criteria (0.0 to 100.0)
    score_cbapa_research_problem = Column(Float, nullable=True)      # 25%
    score_cbapa_methodology_analysis = Column(Float, nullable=True)  # 25%
    score_cbapa_practical_roi = Column(Float, nullable=True)         # 20%
    score_cbapa_literature_theoretical = Column(Float, nullable=True)# 15%
    score_cbapa_professional_delivery = Column(Float, nullable=True) # 15%
    
    total_score = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(String, nullable=True)
    
    abstract_s3_key = Column(String, nullable=True)
    
    messages = relationship("ThesisInterviewMessage", back_populates="session", cascade="all, delete-orphan")


class ThesisInterviewMessage(Base):
    __tablename__ = "thesis_interview_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("thesis_interview_sessions.id"), nullable=False)
    
    role = Column(String, nullable=False) # 'user' or 'ai'
    content = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    
    session = relationship("ThesisInterviewSession", back_populates="messages")

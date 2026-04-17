from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from database import Base
import datetime

class UpcomingStudentInterviewSession(Base):
    __tablename__ = "upcoming_student_interview_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    start_time = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String, default="active", nullable=False) # active, completed, expired
    
    # Grading criteria (0.0 to 100.0)
    score_technical = Column(Float, nullable=True)     # 30%
    score_problem_solving = Column(Float, nullable=True) # 25%
    score_coding = Column(Float, nullable=True)          # 20%
    score_communication = Column(Float, nullable=True)   # 15%
    score_soft_skills = Column(Float, nullable=True)     # 10%
    
    # CTE Grading criteria (0.0 to 100.0)
    score_cte_subject_matter = Column(Float, nullable=True)     # 25%
    score_cte_teaching = Column(Float, nullable=True)           # 20%
    score_cte_communication = Column(Float, nullable=True)      # 20%
    score_cte_motivation = Column(Float, nullable=True)         # 15%
    score_cte_academic = Column(Float, nullable=True)           # 10%
    score_cte_problem_solving = Column(Float, nullable=True)    # 5%
    score_cte_leadership = Column(Float, nullable=True)         # 5%
    
    # CBAPA Grading criteria (0.0 to 100.0)
    score_cbapa_business = Column(Float, nullable=True)         # 25%
    score_cbapa_analytical = Column(Float, nullable=True)       # 20%
    score_cbapa_communication = Column(Float, nullable=True)    # 15%
    score_cbapa_entrepreneurial = Column(Float, nullable=True)  # 15%
    score_cbapa_academic = Column(Float, nullable=True)         # 10%
    score_cbapa_leadership = Column(Float, nullable=True)       # 10%
    score_cbapa_ethical = Column(Float, nullable=True)          # 5%
    
    total_score = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    feedback_summary = Column(String, nullable=True)
    
    messages = relationship("UpcomingStudentInterviewMessage", back_populates="session", cascade="all, delete-orphan")


class UpcomingStudentInterviewMessage(Base):
    __tablename__ = "upcoming_student_interview_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("upcoming_student_interview_sessions.id"), nullable=False)
    
    role = Column(String, nullable=False) # 'user' or 'ai'
    content = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    
    session = relationship("UpcomingStudentInterviewSession", back_populates="messages")

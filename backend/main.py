# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routers import (
    auth,
    user,
    upcoming_student_interview,
    thesis_interview,
    pre_test_intro,
    pre_test_active_listening,
    post_test_interview,
    drills,
    custom_skills
)
from database import engine, Base
import models.user
import models.upcoming_student_interview
import models.thesis_interview
import models.pre_test_intro
import models.pre_test_active_listening
import models.post_test_interview
import models.drills
import models.custom_skills

LOCAL_SCHEMA_ENVIRONMENTS = frozenset({"development", "dev", "local"})


def should_auto_create_schema(environment: str) -> bool:
    """Permit temporary automatic schema creation only in local development."""
    return environment in LOCAL_SCHEMA_ENVIRONMENTS


if should_auto_create_schema(settings.ENVIRONMENT):
    Base.metadata.create_all(bind=engine)

api = FastAPI(
    title="Career Edge AI Backend API",
    description="Career Edge AI Platform Backend",
    version="1.0.4",
)

# Wrap the complete API so even error responses receive CORS headers.
app = CORSMiddleware(
    app=api,
    allow_origins=list(settings.CORS_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

api.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api.include_router(user.router, prefix="/users", tags=["Users"])
api.include_router(upcoming_student_interview.router, prefix="/upcoming-student-interview", tags=["Upcoming Student Interview"])
api.include_router(thesis_interview.router, prefix="/thesis-interview", tags=["Thesis Interview"])
api.include_router(pre_test_intro.router, prefix="/pre-test-intro", tags=["Pre-test Exercises"])
api.include_router(pre_test_active_listening.router, prefix="/pre-test-active-listening", tags=["Pre-test Exercises"])
api.include_router(post_test_interview.router, prefix="/post-test-interview", tags=["Post-test Exercises"])
api.include_router(drills.router, prefix="/drills", tags=["Drills"])
api.include_router(custom_skills.router, prefix="/custom-skills", tags=["Custom Skills AI Session"])


@api.get("/")
async def root():
    return {"message": "Career Edge AI Backend API"}


@api.get("/health")
async def health_check():
    return {"status": "healthy"}

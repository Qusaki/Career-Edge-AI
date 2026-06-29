# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from routers import (
    auth,
    user,
    upcoming_student_interview,
    thesis_interview,
    pre_test_intro,
    pre_test_active_listening,
    post_test_interview
)
from database import engine, Base
import models.user
import models.upcoming_student_interview
import models.thesis_interview
import models.pre_test_intro
import models.pre_test_active_listening
import models.post_test_interview

# Automatically create tables if they don't exist
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Career Edge AI Backend API",
    description="Career Edge AI Platform Backend",
    version="1.0.4",
)

# Add CORS Middleware to allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # frontend url
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(user.router, prefix="/users", tags=["Users"])
app.include_router(upcoming_student_interview.router, prefix="/upcoming-student-interview", tags=["Upcoming Student Interview"])
app.include_router(thesis_interview.router, prefix="/thesis-interview", tags=["Thesis Interview"])
app.include_router(pre_test_intro.router, prefix="/pre-test-intro", tags=["Pre-test Exercises"])
app.include_router(pre_test_active_listening.router, prefix="/pre-test-active-listening", tags=["Pre-test Exercises"])
app.include_router(post_test_interview.router, prefix="/post-test-interview", tags=["Post-test Exercises"])


@app.get("/")
async def root():
    return {"message": "Career Edge AI Backend API"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import (
    auth,
    gemini,
    user,
    interview
)
from database import engine, Base
import models.user
import models.interview

# Automatically create tables if they don't exist
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Career Edge AI Backend API",
    description="Career Edge AI Platform Backend",
    version="1.0.2",
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
app.include_router(gemini.router, prefix="/gemini", tags=["Gemini"])
app.include_router(interview.router, prefix="/interview", tags=["Interview"])


@app.get("/")
async def root():
    return {"message": "Career Edge AI Backend API"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

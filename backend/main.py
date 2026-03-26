from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import (
    auth,
    gemini,
    user
)

app = FastAPI(
    title="Career Edge AI Backend API",
    description="Career Edge AI Platform Backend",
    version="1.0.0",
)

# Add CORS Middleware to allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace with specific frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(user.router, prefix="/users", tags=["Users"])
app.include_router(gemini.router, prefix="/gemini", tags=["Gemini"])


@app.get("/")
async def root():
    return {"message": "Career Edge AI Backend API"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import user as routers_user
from routers import auth as routers_auth

app = FastAPI()

# Add CORS Middleware to allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace with specific frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routers_user.router)
app.include_router(routers_auth.router)


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

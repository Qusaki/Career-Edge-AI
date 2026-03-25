from fastapi import FastAPI
from routers import user as routers_user
from routers import auth as routers_auth
from models import user as models_user
import database 

app = FastAPI()

app.include_router(routers_user.router)
app.include_router(routers_auth.router)

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

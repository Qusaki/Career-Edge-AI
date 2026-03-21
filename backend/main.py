from fastapi import FastAPI
import database
import models

database.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

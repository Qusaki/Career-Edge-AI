import os
import re
from fastapi import APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

def modify_upcoming():
    with open('backend/routers/upcoming_student_interview.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace the grading logic
    target = """    # Send to Ollama with JSON Schema
    system_prompt = get_evaluation_system_prompt(current_user.department)
    
    client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
    model_name = os.getenv("OLLAMA_MODEL", "llama3.2")
    
    prompt = f"{system_prompt}\\\\n\\\\nTranscript:\\\\n{transcript}\\\\n\\\\nRespond with ONLY valid JSON containing the requested scores and feedback_summary."
    
    response = client.chat.completions.create(
        model=model_name,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    
    try:
        evaluation = json.loads(response.choices[0].message.content)"""
        
    replacement = """    if not request.evaluation:
        raise HTTPException(status_code=400, detail="Missing frontend evaluation data.")
        
    try:
        evaluation = request.evaluation"""
        
    if target in content:
        content = content.replace(target, replacement)
        with open('backend/routers/upcoming_student_interview.py', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Upcoming patched")
    else:
        print("Upcoming target not found")

modify_upcoming()

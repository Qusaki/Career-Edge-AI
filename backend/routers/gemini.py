import os
import json
import asyncio
import re
from fastapi import APIRouter, HTTPException, Depends, Request
from sse_starlette.sse import EventSourceResponse
import google.generativeai as genai
from schemas.gemini import GeminiRequest
from dotenv import load_dotenv
from core.deps import get_current_user
from core.tts import generate_tts_base64_async
from models.user import User

load_dotenv(override=True)

def strip_markdown_for_tts(text: str) -> str:
    """Removes Markdown symbols so the TTS engine speaks naturally."""
    text = re.sub(r'[*_]', '', text)
    text = re.sub(r'#+\s', '', text)
    return text.strip()

router = APIRouter()

api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

@router.post("/generate")
async def generate_text_response(request: Request, body: GeminiRequest, current_user: User = Depends(get_current_user)):
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set in the environment variables.")

    async def event_generator():
        queue = asyncio.Queue()
        
        async def process_tts(text_to_speak: str):
            """Generates TTS and puts the audio chunk into the queue."""
            audio_b64 = await generate_tts_base64_async(text_to_speak)
            if audio_b64:
                await queue.put({
                    "event": "audio",
                    "data": json.dumps({"audio_base64": audio_b64})
                })

        async def process_gemini():
            """Streams text tokens from Gemini, splits sentences, and fires off TTS tasks."""
            tts_tasks = []
            try:
                # Use gemini-2.0-flash for ultra-low latency
                model = genai.GenerativeModel('gemini-2.0-flash')
                response_stream = await model.generate_content_async(body.text, stream=True)
                
                sentence_buffer = ""
                
                async for chunk in response_stream:
                    if chunk.text:
                        # Yield the raw text instantly to the client
                        await queue.put({
                            "event": "text",
                            "data": json.dumps({"text": chunk.text})
                        })
                        
                        sentence_buffer += chunk.text
                        
                        # Aggressive splitting for low latency
                        delimiters = ['. ', '! ', '? ', '.\n', '!\n', '?\n', ': ', '; ', ', ', '\n']
                        for punctuation in delimiters:
                            if punctuation in sentence_buffer:
                                parts = sentence_buffer.split(punctuation)
                                # Reattach punctuation
                                text_to_speak = parts[0] + punctuation[0]
                                sanitized_text = strip_markdown_for_tts(text_to_speak)
                                
                                # Send to TTS if it's the first chunk or long enough
                                if len(sanitized_text.strip()) > 10 or len(tts_tasks) == 0:
                                    task = asyncio.create_task(process_tts(sanitized_text))
                                    tts_tasks.append(task)
                                    sentence_buffer = punctuation.join(parts[1:])
                                    break
                                
                # If there's any remaining text in the buffer after the stream completes
                if sentence_buffer.strip():
                    sanitized_remainder = strip_markdown_for_tts(sentence_buffer)
                    task = asyncio.create_task(process_tts(sanitized_remainder))
                    tts_tasks.append(task)
                    
            except Exception as e:
                await queue.put({
                    "event": "error",
                    "data": json.dumps({"error": str(e)})
                })
            finally:
                # Wait for any lingering TTS audio generations to finish before sending the close signal
                if tts_tasks:
                    await asyncio.gather(*tts_tasks, return_exceptions=True)
                await queue.put(None) 

        # Fire off the worker task
        producer = asyncio.create_task(process_gemini())
        
        # Consume the queue and yield to the SSE response
        while True:
            if await request.is_disconnected():
                producer.cancel()
                break
                
            msg = await queue.get()
            if msg is None:
                break
            # sse_starlette expects a dict with event/data keys
            yield msg

    return EventSourceResponse(event_generator())
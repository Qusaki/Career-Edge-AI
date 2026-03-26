from pydantic import BaseModel

class GeminiRequest(BaseModel):
    text: str

from typing import Optional

class GeminiResponse(BaseModel):
    response: str
    audio_base64: Optional[str] = None

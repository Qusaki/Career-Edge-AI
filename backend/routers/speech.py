"""Authenticated, ephemeral transcription of a user's recorded answer."""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core.deps import get_current_user
from models.user import User
from services.ai_provider import AIProviderError, get_ai_provider

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_TRANSCRIPTION_BYTES = 14 * 1024 * 1024  # Inline base64 remains below Gemini's 20 MB request limit.
ACCEPTED_AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav"}


def validated_audio_type(content_type: str, data: bytes) -> str:
    declared = content_type.split(";", 1)[0].strip().lower()
    if declared not in ACCEPTED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="This audio format is not supported.")
    signatures = {
        "audio/webm": data.startswith(b"\x1a\x45\xdf\xa3"),
        "audio/ogg": data.startswith(b"OggS"),
        "audio/mp4": len(data) >= 12 and data[4:8] == b"ftyp",
        "audio/wav": data.startswith(b"RIFF") and data[8:12] == b"WAVE",
    }
    if not signatures[declared]:
        raise HTTPException(status_code=415, detail="The recording is not valid audio in the selected format.")
    # The browser records MP4/M4A with MediaRecorder; Gemini calls that MIME audio/m4a.
    return "audio/m4a" if declared == "audio/mp4" else declared


@router.post("/transcribe")
async def transcribe_answer(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    del current_user  # Authentication is mandatory; no session or file is persisted here.
    data = await file.read(MAX_TRANSCRIPTION_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The recording is empty. Please speak and try again.")
    if len(data) > MAX_TRANSCRIPTION_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too large. Please record a shorter answer.")
    mime_type = validated_audio_type(file.content_type or "", data)
    try:
        transcript = (await get_ai_provider().transcribe_audio(data, mime_type)).strip()
    except AIProviderError as error:
        logger.warning("Answer transcription unavailable (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Speech processing is temporarily unavailable. Your recording can be retried.") from None
    except Exception as error:
        logger.warning("Answer transcription failed (%s)", type(error).__name__)
        raise HTTPException(status_code=503, detail="Speech processing is temporarily unavailable. Your recording can be retried.") from None
    if not transcript:
        raise HTTPException(status_code=422, detail="No speech was detected. Please speak and try again.")
    return {"transcript": transcript}

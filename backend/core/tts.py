import base64
import os
import logging
from google.cloud import texttospeech

logger = logging.getLogger(__name__)

async def generate_tts_base64_async(text: str) -> str | None:
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        logger.warning("GOOGLE_APPLICATION_CREDENTIALS not set. Skipping TTS generation.")
        return None
        
    try:
        # Use Async client to prevent blocking the event loop
        client = texttospeech.TextToSpeechAsyncClient()
        synthesis_input = texttospeech.SynthesisInput(text=text)

        voice = texttospeech.VoiceSelectionParams(
            language_code="en-US", ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL
        )

        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )

        response = await client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )

        return base64.b64encode(response.audio_content).decode("utf-8")
    except Exception as e:
        logger.error(f"TTS Generation failed: {e}")
        return None

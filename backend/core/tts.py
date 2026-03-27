import base64
import os
import json
import logging
from google.cloud import texttospeech
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

async def generate_tts_base64_async(text: str) -> str | None:
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    file_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    
    if not creds_json and not file_creds:
        logger.warning("Google TTS credentials not set. Skipping TTS generation.")
        return None
        
    try:
        # Generate credentials from either JSON content or fallback to default file
        if creds_json:
            creds_dict = json.loads(creds_json)
            credentials = service_account.Credentials.from_service_account_info(creds_dict)
            client = texttospeech.TextToSpeechAsyncClient(credentials=credentials)
        else:
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

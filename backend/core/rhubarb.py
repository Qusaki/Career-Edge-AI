import os
import subprocess
import json
import tempfile
import wave

class RhubarbLipSync:
    """
    Wrapper for the Rhubarb Lip Sync command-line tool.
    Requires 'rhubarb' executable to be locally available or configured in Docker.
    """
    def __init__(self, rhubarb_path: str = "rhubarb"):
        self.rhubarb_path = rhubarb_path
        
    def generate_lip_sync(self, audio_filepath: str) -> dict:
        """
        Runs Rhubarb on a given audio file (WAV or OGG) and returns the lip sync data as a dictionary.
        """
        try:
            # -f json tells Rhubarb to output JSON format
            cmd = [
                self.rhubarb_path,
                "-f", "json",
                audio_filepath
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            return json.loads(result.stdout)
            
        except subprocess.CalledProcessError as e:
            error_msg = f"Rhubarb execution failed with code {e.returncode}. stderr: {e.stderr}"
            print(error_msg)
            raise RuntimeError(error_msg)
        except FileNotFoundError:
            error_msg = f"Rhubarb executable not found at '{self.rhubarb_path}'. Are you sure it's installed or in PATH?"
            print(error_msg)
            raise RuntimeError(error_msg)
            
    def process_pcm_audio(self, pcm_bytes: bytes, sample_rate: int = 24000, sample_width: int = 2, channels: int = 1) -> dict:
        """
        Takes raw PCM audio bytes (like from Gemini Live stream), 
        temporarily writes them to a WAV file with correct headers, 
        runs Rhubarb, and returns the lip sync JSON.
        
        Args:
            pcm_bytes: Raw PCM audio bytes.
            sample_rate: Default 24000 for Gemini Live 
            sample_width: Default 2 bytes (16-bit PCM)
            channels: Default 1 (Mono)
        """
        
        # We need a delete=False initially so 'wave' can close it and 'subprocess' can read it.
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_wav:
            temp_wav_path = temp_wav.name
            
        try:
            # Write raw PCM to a proper WAV file so Rhubarb can understand it
            with wave.open(temp_wav_path, 'wb') as wav_file:
                wav_file.setnchannels(channels)
                wav_file.setsampwidth(sample_width)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm_bytes)
                
            return self.generate_lip_sync(temp_wav_path)
        finally:
            # Cleanup temp file
            if os.path.exists(temp_wav_path):
                os.remove(temp_wav_path)
                
    def process_mp3_audio(self, mp3_bytes: bytes) -> dict:
        """
        Takes raw MP3 audio bytes, converts to WAV using ffmpeg, runs Rhubarb, and returns lip sync JSON.
        Requires ffmpeg installed on system.
        """
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp_mp3:
            temp_mp3.write(mp3_bytes)
            temp_mp3_path = temp_mp3.name
            
        temp_wav_path = temp_mp3_path.replace(".mp3", ".wav")
            
        try:
            # Convert MP3 to WAV because Rhubarb needs WAV or OGG
            try:
                subprocess.run(["ffmpeg", "-y", "-i", temp_mp3_path, temp_wav_path], check=True, capture_output=True)
            except FileNotFoundError:
                error_msg = "ffmpeg not found. Please install ffmpeg to process MP3 audio for lip sync."
                print(error_msg)
                raise RuntimeError(error_msg)
                
            return self.generate_lip_sync(temp_wav_path)
        finally:
            if os.path.exists(temp_mp3_path):
                os.remove(temp_mp3_path)
            if os.path.exists(temp_wav_path):
                os.remove(temp_wav_path)

# Updated global instance to use local installed binary
RHUBARB_EXE = r"C:\Users\John Marcel Aleman\Desktop\Career-Edge-AI\backend\bin\Rhubarb-Lip-Sync-1.13.0-Windows\rhubarb.exe"
rhubarb_syncer = RhubarbLipSync(rhubarb_path=RHUBARB_EXE)

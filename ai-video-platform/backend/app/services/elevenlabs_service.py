"""
ElevenLabsService — voice narration generation.
"""
import asyncio
import tempfile
from pathlib import Path

import httpx
from mutagen.mp3 import MP3

from app.core.config import settings
from app.core.logging_config import get_logger
from app.core.storage import storage

logger = get_logger(__name__)

ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"


class ElevenLabsService:

    def __init__(self) -> None:
        self.api_key = settings.elevenlabs_api_key
        self.default_voice_id = settings.elevenlabs_default_voice_id
        self.model_id = settings.elevenlabs_model_id

    async def generate_narration(
        self,
        project_id: str,
        narration_text: str,
        voice_id: str | None = None,
        scene_number: int | None = None,
        stability: float = 0.5,
        similarity_boost: float = 0.75,
        style: float = 0.0,
        use_speaker_boost: bool = True,
    ) -> tuple[str, float]:
        """
        Generate narration audio using ElevenLabs TTS.

        Returns:
            Tuple of (public_url, duration_seconds)
        """
        voice_id = voice_id or self.default_voice_id
        logger.info(
            "elevenlabs_generation_started",
            project_id=project_id,
            voice_id=voice_id,
            text_length=len(narration_text),
            scene_number=scene_number,
        )

        url = f"{ELEVENLABS_BASE_URL}/text-to-speech/{voice_id}"

        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }

        payload = {
            "text": narration_text,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": stability,
                "similarity_boost": similarity_boost,
                "style": style,
                "use_speaker_boost": use_speaker_boost,
            },
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            audio_bytes = response.content

        # Save temporarily to measure duration
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            duration = self._get_mp3_duration(tmp_path)
        except Exception:
            duration = self._estimate_duration(narration_text)

        # Upload to storage
        if scene_number is not None:
            storage_path = storage.scene_path(project_id, scene_number, "narration.mp3")
        else:
            storage_path = storage.audio_path(project_id, "narration.mp3")
            
        public_url = await storage.upload_bytes(audio_bytes, storage_path, "audio/mpeg")

        Path(tmp_path).unlink(missing_ok=True)

        logger.info(
            "elevenlabs_generation_completed",
            project_id=project_id,
            duration=duration,
            file_size=len(audio_bytes),
        )

        return public_url, duration

    def _get_mp3_duration(self, mp3_path: str) -> float:
        """Get actual duration of an MP3 file using mutagen."""
        audio = MP3(mp3_path)
        return audio.info.length

    def _estimate_duration(self, text: str) -> float:
        """Fallback: estimate duration from word count (2.5 words/sec)."""
        words = len(text.split())
        return words / 2.5

    async def list_voices(self) -> list[dict]:
        """Return available voices from ElevenLabs."""
        url = f"{ELEVENLABS_BASE_URL}/voices"
        headers = {"xi-api-key": self.api_key}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
        return data.get("voices", [])

    def build_full_narration(self, scenes: list) -> str:
        """Concatenate narrations from all scenes in order."""
        parts = []
        for scene in sorted(scenes, key=lambda s: s.scene_number):
            parts.append(scene.narration.strip())
        return " ".join(parts)

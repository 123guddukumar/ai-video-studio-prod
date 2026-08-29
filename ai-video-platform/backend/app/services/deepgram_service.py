"""
Deepgram Transcription Service.
Transcribes audio using Deepgram's Nova-2 model and generates precise timed SRT subtitles.
"""
import httpx
from typing import List, Dict
from app.core.config import settings
from app.core.logging_config import get_logger

logger = get_logger(__name__)


class DeepgramService:
    def __init__(self):
        self.api_key = settings.deepgram_api_key

    async def transcribe_audio(self, audio_bytes: bytes, language: str = "en") -> List[Dict]:
        """
        Sends audio bytes to Deepgram listen endpoint and returns word-level timestamps.
        """
        if not self.api_key:
            raise ValueError("DEEPGRAM_API_KEY is not configured")

        url = "https://api.deepgram.com/v1/listen"
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "audio/mpeg"
        }
        params = {
            "model": "nova-2",
            "smart_format": "true",
            "punctuate": "true",
            "language": language
        }

        logger.info("calling_deepgram_api", language=language, size_bytes=len(audio_bytes))

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, content=audio_bytes, headers=headers, params=params)
            
            if response.status_code != 200:
                error_detail = response.text
                logger.error("deepgram_api_failed", status_code=response.status_code, detail=error_detail)
                raise RuntimeError(f"Deepgram API returned status {response.status_code}: {error_detail}")

            data = response.json()
            try:
                words = data["results"]["channels"][0]["alternatives"][0]["words"]
                logger.info("deepgram_api_success", word_count=len(words))
                return words
            except (KeyError, IndexError) as e:
                logger.error("deepgram_response_parsing_failed", error=str(e), response=str(data)[:500])
                raise RuntimeError(f"Could not parse words from Deepgram response: {e}")

    def words_to_srt(self, words: List[Dict], aspect_ratio: str = "16:9") -> str:
        """
        Groups word-level timestamps into readable, timed SRT subtitle blocks.
        Adjusts limits based on aspect ratio (e.g. mobile 9:16 has shorter lines).
        """
        if not words:
            return ""

        # Configure word limits based on aspect ratio
        max_words_per_line = 5 if aspect_ratio in ["9:16", "1:1"] else 9
        max_lines_per_block = 2
        max_words_per_block = max_words_per_line * max_lines_per_block
        max_duration = 3.0  # seconds
        max_gap = 1.0  # seconds

        blocks = []
        current_block_words = []

        for word_data in words:
            word = word_data.get("word", "")
            start = word_data.get("start", 0.0)
            end = word_data.get("end", 0.0)

            should_split = False
            if len(current_block_words) >= max_words_per_block:
                should_split = True
            elif current_block_words:
                block_start = current_block_words[0]["start"]
                if (end - block_start) > max_duration:
                    should_split = True
                elif (start - current_block_words[-1]["end"]) > max_gap:
                    should_split = True

            if should_split and current_block_words:
                blocks.append(current_block_words)
                current_block_words = []

            current_block_words.append({
                "word": word,
                "start": start,
                "end": end
            })

        if current_block_words:
            blocks.append(current_block_words)

        # Format blocks into SRT format
        srt_lines = []
        for idx, block in enumerate(blocks, 1):
            block_start = block[0]["start"]
            block_end = block[-1]["end"]

            # Build subtitle text (wrapped into lines)
            words_text = [w["word"] for w in block]
            lines = []
            for j in range(0, len(words_text), max_words_per_line):
                lines.append(" ".join(words_text[j:j + max_words_per_line]))
            subtitle_text = "\n".join(lines)

            start_str = self._format_time(block_start)
            end_str = self._format_time(block_end)

            srt_lines.append(f"{idx}\n{start_str} --> {end_str}\n{subtitle_text}\n")

        return "\n".join(srt_lines)

    def _format_time(self, seconds: float) -> str:
        hrs = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"

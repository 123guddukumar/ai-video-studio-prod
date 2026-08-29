"""
Application configuration — loaded from environment variables.
All keys are read from .env via pydantic-settings.
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ────────────────────────────────────────────────────────
    app_env: Literal["development", "production", "test"] = "development"
    app_name: str = "AI Video Platform"
    api_v1_prefix: str = "/api"
    debug: bool = True

    # ── Database ────────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://videogen:videogen@postgres:5432/videogendb"
    database_url_sync: str = "postgresql://videogen:videogen@postgres:5432/videogendb"
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # ── Redis ───────────────────────────────────────────────────────────────
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = "redis://redis:6379/1"
    celery_result_backend: str = "redis://redis:6379/2"

    # ── Storage ─────────────────────────────────────────────────────────────
    storage_backend: Literal["local"] = "local"
    local_storage_path: str = "/app/storage/projects"
    storage_public_url: str = "http://localhost:8000/storage"

    # ── Groq ────────────────────────────────────────────────────────────────
    groq_api_key: str = ""
    groq_model: str = "groq/compound-mini"
    groq_max_retries: int = 3
    groq_temperature: float = 0.7
    groq_max_tokens: int = 4096

    # ── ElevenLabs ──────────────────────────────────────────────────────────
    elevenlabs_api_key: str = ""
    elevenlabs_default_voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    elevenlabs_model_id: str = "eleven_monolingual_v1"
    deepgram_api_key: str = ""

    # ── Flow Worker ─────────────────────────────────────────────────────────
    flow_worker_url: str = "http://flow-worker:8001"
    flow_timeout_seconds: int = 600
    flow_max_retries: int = 3

    # ── Video Worker ─────────────────────────────────────────────────────────
    video_worker_url: str = "http://video-worker:8002"
    ffmpeg_path: str = "/usr/bin/ffmpeg"
    ffprobe_path: str = "/usr/bin/ffprobe"
    output_resolution: str = "1920x1080"
    output_fps: int = 30
    output_video_codec: str = "libx264"
    output_audio_codec: str = "aac"

    # ── Security ────────────────────────────────────────────────────────────
    secret_key: str = Field(default="dev-secret-key-change-in-prod")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 1 week

    # ── Single-user dev mode ─────────────────────────────────────────────────
    dev_user_id: str = "dev-user-001"
    dev_user_name: str = "Developer"
    dev_user_email: str = "dev@localhost"


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()


settings = get_settings()

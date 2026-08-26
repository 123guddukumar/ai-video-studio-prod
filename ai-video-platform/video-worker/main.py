"""
Video Worker main entry — FastAPI server for video composition requests.
"""
from contextlib import asynccontextmanager
import asyncio

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("video_worker_starting")
    yield
    logger.info("video_worker_stopping")


app = FastAPI(title="Video Worker", version="1.0.0", lifespan=lifespan)


class SceneVideoInfo(BaseModel):
    scene_number: int
    video_path: str
    duration: int
    narration: str


class ComposeRequest(BaseModel):
    project_id: str
    scene_videos: list[SceneVideoInfo]
    audio_path: str
    output_path: str
    subtitle_path: str
    resolution: str = "1920x1080"
    fps: int = 30
    audio_duration: Optional[float] = None
    subtitles_enabled: bool = True
    background_music: bool = False
    aspect_ratio: str = "16:9"


@app.post("/compose")
async def compose_video(req: ComposeRequest):
    """Compose the final video from scene clips, audio, and subtitles."""
    logger.info(
        "compose_request_received",
        project_id=req.project_id,
        scene_count=len(req.scene_videos),
    )

    try:
        # Run FFmpeg in thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()

        def _run_composition():
            from composition.composer import VideoComposer
            composer = VideoComposer(
                project_id=req.project_id,
                resolution=req.resolution,
                fps=req.fps,
            )
            return composer.compose(
                scene_videos=[s.model_dump() for s in req.scene_videos],
                audio_path=req.audio_path,
                output_path=req.output_path,
                subtitle_path=req.subtitle_path,
                audio_duration=req.audio_duration,
                subtitles_enabled=req.subtitles_enabled,
                background_music_path=None,  # TODO: implement background music path
            )

        output_path = await loop.run_in_executor(None, _run_composition)

        from pathlib import Path
        file_size = Path(output_path).stat().st_size if Path(output_path).exists() else 0

        logger.info(
            "composition_finished",
            project_id=req.project_id,
            output_path=output_path,
            file_size=file_size,
        )

        return {
            "success": True,
            "output_path": output_path,
            "file_size": file_size,
        }

    except Exception as e:
        logger.error("composition_failed", project_id=req.project_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    import subprocess
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        ffmpeg_version = result.stdout.split("\n")[0] if result.returncode == 0 else "unknown"
    except Exception:
        ffmpeg_version = "error"

    return {
        "status": "healthy",
        "ffmpeg": ffmpeg_version,
    }

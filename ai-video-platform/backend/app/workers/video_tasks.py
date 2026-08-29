"""
Video composition Celery task — delegates to the video-worker microservice.
"""
import asyncio

import httpx
from celery import Task
from sqlalchemy import select

from app.workers.celery_app import celery_app
from app.core.config import settings
from app.core.logging_config import get_logger
from app.core.database import AsyncSessionFactory
from app.core.storage import storage
from app.models.project import Project, ProjectStatus
from app.models.scene import Scene
from app.models.job import Job, JobType, JobStatus
from app.services.websocket_manager import ws_manager

logger = get_logger(__name__)


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="app.workers.video_tasks.compose_video_task", max_retries=2)
def compose_video_task(self: Task, project_id: str, job_id: str) -> dict:
    return run_async(_compose_video_async(self, project_id, job_id))


async def _compose_video_async(task: Task, project_id: str, job_id: str) -> dict:
    async with AsyncSessionFactory() as db:
        project = await _get_project(db, project_id)
        job = await _get_job(db, job_id)

        if not project or not job:
            return {"error": "not_found"}

        try:
            job.status = JobStatus.PROCESSING
            project.status = ProjectStatus.PROCESSING
            project.current_stage = "VIDEO_COMPOSITION"
            await db.commit()

            await ws_manager.broadcast_progress(
                project_id=project_id,
                stage="VIDEO_COMPOSITION",
                progress=72.0,
                status="processing",
                extra={"message": "Composing final video with FFmpeg..."},
            )

            # Get all scenes with their video paths
            result = await db.execute(
                select(Scene)
                .where(Scene.project_id == project_id)
                .order_by(Scene.scene_number)
            )
            scenes = list(result.scalars().all())

            # Build scene video paths
            scene_videos = []
            for scene in scenes:
                video_path = storage.get_local_path(
                    storage.scene_path(project_id, scene.scene_number, "video.mp4")
                )
                scene_videos.append({
                    "scene_number": scene.scene_number,
                    "video_path": str(video_path),
                    "duration": scene.duration,
                    "narration": scene.narration,
                })

            audio_path = str(storage.get_local_path(storage.audio_path(project_id)))
            output_path = str(storage.get_local_path(storage.final_path(project_id)))
            subtitle_path = str(storage.get_local_path(storage.subtitle_path(project_id)))

            # Call video-worker
            payload = {
                "project_id": project_id,
                "scene_videos": scene_videos,
                "audio_path": audio_path,
                "output_path": output_path,
                "subtitle_path": subtitle_path,
                "resolution": project.resolution,
                "fps": settings.output_fps,
                "audio_duration": project.narration_duration,
                "subtitles_enabled": project.subtitles_enabled,
                "subtitle_style": project.subtitle_style,
                "background_music": project.background_music,
                "aspect_ratio": project.aspect_ratio,
            }

            async with httpx.AsyncClient(timeout=600.0) as client:
                response = await client.post(
                    f"{settings.video_worker_url}/compose",
                    json=payload,
                )
                response.raise_for_status()
                result_data = response.json()

            # Final video is now at output_path — register the URL
            final_storage_path = storage.final_path(project_id)
            public_url = storage.get_public_url(final_storage_path)
            project.final_video_url = public_url

            # Get thumbnail from first scene
            thumb_path = storage.scene_path(project_id, 1, "image.png")
            if await storage.file_exists(thumb_path):
                project.thumbnail_url = storage.get_public_url(thumb_path)

            # Register subtitles
            if project.subtitles_enabled and await storage.file_exists(
                storage.subtitle_path(project_id)
            ):
                project.subtitle_url = storage.get_public_url(
                    storage.subtitle_path(project_id)
                )

            # Mark complete
            project.status = ProjectStatus.COMPLETED
            project.progress = 100.0
            project.current_stage = "COMPLETED"

            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.output_data = {"final_video_url": public_url}
            await db.commit()

            await ws_manager.broadcast_completed(project_id, public_url)

            logger.info(
                "video_composition_completed",
                project_id=project_id,
                final_video_url=public_url,
            )
            return {"status": "success", "final_video_url": public_url}

        except Exception as exc:
            logger.error("video_composition_failed", project_id=project_id, error=str(exc))
            job.status = JobStatus.FAILED
            job.error_message = str(exc)
            project.status = ProjectStatus.FAILED
            project.error_message = f"Video composition failed: {exc}"
            await db.commit()
            await ws_manager.broadcast_error(project_id, "VIDEO_COMPOSITION", str(exc))
            raise


async def _get_project(db, project_id: str):
    result = await db.execute(select(Project).where(Project.id == project_id))
    return result.scalar_one_or_none()


async def _get_job(db, job_id: str):
    result = await db.execute(select(Job).where(Job.id == job_id))
    return result.scalar_one_or_none()

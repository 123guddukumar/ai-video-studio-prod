"""
Voice generation Celery task — ElevenLabs TTS.
"""
import asyncio

from celery import Task
from sqlalchemy import select

from app.workers.celery_app import celery_app
from app.core.logging_config import get_logger
from app.core.database import AsyncSessionFactory
from app.models.project import Project, ProjectStatus, GenerationMode
from app.models.scene import Scene
from app.models.job import Job, JobType, JobStatus
from app.services.elevenlabs_service import ElevenLabsService
from app.services.websocket_manager import ws_manager

logger = get_logger(__name__)
elevenlabs = ElevenLabsService()


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="app.workers.voice_tasks.generate_voice_task", max_retries=3)
def generate_voice_task(self: Task, project_id: str, job_id: str) -> dict:
    return run_async(_generate_voice_async(self, project_id, job_id))


async def _generate_voice_async(task: Task, project_id: str, job_id: str) -> dict:
    async with AsyncSessionFactory() as db:
        project = await _get_project(db, project_id)
        job = await _get_job(db, job_id)

        if not project or not job:
            return {"error": "not_found"}

        try:
            job.status = JobStatus.PROCESSING
            project.status = ProjectStatus.PROCESSING
            project.current_stage = "ELEVENLABS_GENERATION"
            await db.commit()

            await ws_manager.broadcast_progress(
                project_id=project_id,
                stage="ELEVENLABS_GENERATION",
                progress=62.0,
                status="processing",
                extra={"message": "Generating voice narration..."},
            )

            # Build full narration text
            result = await db.execute(
                select(Scene)
                .where(Scene.project_id == project_id)
                .order_by(Scene.scene_number)
            )
            scenes = list(result.scalars().all())

            # 1. Generate individual narration audio for each scene sequentially using a Semaphore
            from app.core.storage import storage
            sem = asyncio.Semaphore(1)
            async def generate_scene_voice(scene):
                async with sem:
                    scene_audio_path = storage.scene_path(project_id, scene.scene_number, "narration.mp3")
                    # Check if audio already exists (resume support)
                    if await storage.file_exists(scene_audio_path):
                        local_path = storage.get_local_path(scene_audio_path)
                        try:
                            duration = elevenlabs._get_mp3_duration(str(local_path))
                            return scene.scene_number, duration
                        except Exception:
                            pass # regenerate if corrupt
                    
                    logger.info("generating_scene_narration", scene=scene.scene_number, text=scene.narration[:30])
                    _, duration = await elevenlabs.generate_narration(
                        project_id=project_id,
                        narration_text=scene.narration,
                        voice_id=project.voice_id,
                        scene_number=scene.scene_number
                    )
                    # Wait 1 second to stay within API rate limit constraints
                    await asyncio.sleep(1.0)
                    return scene.scene_number, duration

            try:
                scene_results = await asyncio.gather(*(generate_scene_voice(scene) for scene in scenes))
                # Update scene durations based on actual narration audio duration plus 0.5s padding (minimum 3s)
                for scene_num, duration in scene_results:
                    for scene in scenes:
                        if scene.scene_number == scene_num:
                            scene.duration = max(3, int(round(duration + 0.5)))
                            logger.info("updated_scene_duration", scene=scene_num, duration=scene.duration)
                await db.commit()
            except Exception as e:
                logger.error("individual_voice_generation_failed", error=str(e))

            # Concatenate individual scene audio files locally instead of calling ElevenLabs again
            import aiofiles
            combined_bytes = b""
            audio_duration = 0.0
            
            sorted_scenes = sorted(scenes, key=lambda s: s.scene_number)
            for scene in sorted_scenes:
                scene_audio_path = storage.scene_path(project_id, scene.scene_number, "narration.mp3")
                local_path = storage.get_local_path(scene_audio_path)
                
                if await storage.file_exists(scene_audio_path):
                    async with aiofiles.open(local_path, "rb") as f:
                        combined_bytes += await f.read()
                    try:
                        audio_duration += elevenlabs._get_mp3_duration(str(local_path))
                    except Exception:
                        audio_duration += elevenlabs._estimate_duration(scene.narration)
                else:
                    logger.warning("missing_scene_audio_during_concatenation", scene=scene.scene_number)
            
            if not combined_bytes:
                raise RuntimeError("No scene audio files found to concatenate")
                
            # Upload combined master audio to storage
            master_audio_path = storage.audio_path(project_id, "narration.mp3")
            audio_url = await storage.upload_bytes(combined_bytes, master_audio_path, "audio/mpeg")
            logger.info("concat_voice_generation_completed", project_id=project_id, duration=audio_duration, size=len(combined_bytes))

            project.narration_url = audio_url
            project.narration_duration = audio_duration
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.output_data = {"audio_url": audio_url, "duration": audio_duration}
            await db.commit()

            await ws_manager.broadcast_progress(
                project_id=project_id,
                stage="ELEVENLABS_GENERATION",
                progress=70.0,
                status="completed",
                extra={"audio_url": audio_url, "duration": audio_duration},
            )

            # Queue video composition
            await _queue_video_composition(db, project_id)
            return {"status": "success", "audio_url": audio_url, "duration": audio_duration}

        except Exception as exc:
            logger.error("voice_generation_failed", project_id=project_id, error=str(exc))
            job.status = JobStatus.FAILED
            job.error_message = str(exc)
            project.status = ProjectStatus.FAILED
            project.error_message = f"Voice generation failed: {exc}"
            await db.commit()
            await ws_manager.broadcast_error(project_id, "ELEVENLABS_GENERATION", str(exc))
            raise


async def _queue_video_composition(db, project_id: str) -> None:
    from app.workers.video_tasks import compose_video_task

    project = await _get_project(db, project_id)
    if not project:
        return

    project.current_stage = "VIDEO_COMPOSITION"

    job = Job(
        project_id=project_id,
        job_type=JobType.VIDEO_COMPOSITION,
        status=JobStatus.PENDING,
    )
    db.add(job)
    await db.flush()
    await db.commit()

    celery_task = compose_video_task.delay(project_id, job.id)
    job.celery_task_id = celery_task.id
    await db.commit()


async def _get_project(db, project_id: str):
    result = await db.execute(select(Project).where(Project.id == project_id))
    return result.scalar_one_or_none()


async def _get_job(db, job_id: str):
    result = await db.execute(select(Job).where(Job.id == job_id))
    return result.scalar_one_or_none()

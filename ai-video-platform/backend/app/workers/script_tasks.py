"""
Script generation Celery tasks.
"""
import asyncio
from datetime import datetime, timezone

from celery import Task
from sqlalchemy import select

from app.workers.celery_app import celery_app
from app.core.logging_config import get_logger
from app.core.database import AsyncSessionFactory
from app.models.project import Project, ProjectStatus, GenerationMode
from app.models.job import Job, JobType, JobStatus
from app.schemas.script import ScriptSchema
from app.services.script_service import ScriptService
from app.services.project_service import ProjectService
from app.services.websocket_manager import ws_manager

logger = get_logger(__name__)

script_service = ScriptService()
project_service = ProjectService()


def run_async(coro):
    """Run an async coroutine from a synchronous Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="app.workers.script_tasks.generate_script_task", max_retries=3)
def generate_script_task(self: Task, project_id: str, job_id: str) -> dict:
    """Generate AI script for the project."""
    return run_async(_generate_script_async(self, project_id, job_id))


async def _generate_script_async(task: Task, project_id: str, job_id: str) -> dict:
    async with AsyncSessionFactory() as db:
        # Load project and job
        project = await _get_project(db, project_id)
        job = await _get_job(db, job_id)

        if not project or not job:
            logger.error("project_or_job_not_found", project_id=project_id, job_id=job_id)
            return {"error": "not_found"}

        try:
            # Update status
            job.status = JobStatus.PROCESSING
            project.status = ProjectStatus.PROCESSING
            project.current_stage = "SCRIPT_GENERATION"
            await db.commit()

            await ws_manager.broadcast_progress(
                project_id=project_id,
                stage="SCRIPT_GENERATION",
                progress=5.0,
                status="processing",
                extra={"message": "AI directors are crafting your script..."},
            )

            # Generate script
            script: ScriptSchema = await script_service.generate_script(
                project_id=project_id,
                prompt=project.prompt,
                duration=project.duration,
                language=project.language,
                video_style=project.video_style or "cinematic documentary",
                image_style=project.image_style or "cinematic realistic",
                aspect_ratio=project.aspect_ratio,
            )

            # Save to DB
            await project_service.save_script_to_project(db, project, script)
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.output_data = {"scene_count": len(script.scenes), "title": script.title}

            await ws_manager.broadcast_progress(
                project_id=project_id,
                stage="SCRIPT_GENERATION",
                progress=15.0,
                status="completed",
                extra={"title": script.title, "scene_count": len(script.scenes)},
            )

            # Determine next step based on generation mode
            mode = project.generation_mode
            if mode == GenerationMode.REVIEW_SCRIPT or mode == GenerationMode.REVIEW_BEFORE_FINAL:
                project.status = ProjectStatus.AWAITING_APPROVAL
                project.current_stage = "AWAITING_SCRIPT_APPROVAL"
                await db.commit()
                await ws_manager.broadcast_progress(
                    project_id=project_id,
                    stage="AWAITING_SCRIPT_APPROVAL",
                    progress=15.0,
                    status="awaiting_approval",
                    extra={"message": "Script ready for review. Please approve to continue."},
                )
                return {"status": "awaiting_approval", "scene_count": len(script.scenes)}

            # Auto-continue to asset generation
            await db.commit()

            from app.workers.asset_tasks import generate_assets_task
            next_job = Job(
                project_id=project_id,
                job_type=JobType.FLOW_IMAGE_GENERATION,
                status=JobStatus.PENDING,
            )
            db.add(next_job)
            await db.flush()
            await db.commit()

            celery_task = generate_assets_task.delay(project_id, next_job.id)
            next_job.celery_task_id = celery_task.id
            await db.commit()

            return {"status": "success", "scene_count": len(script.scenes)}

        except Exception as exc:
            logger.error(
                "script_generation_task_failed",
                project_id=project_id,
                job_id=job_id,
                error=str(exc),
            )
            job.status = JobStatus.FAILED
            job.error_message = str(exc)
            project.status = ProjectStatus.FAILED
            project.error_message = f"Script generation failed: {exc}"
            await db.commit()

            await ws_manager.broadcast_error(
                project_id=project_id,
                stage="SCRIPT_GENERATION",
                error=str(exc),
            )
            raise


@celery_app.task(name="app.workers.script_tasks.detect_stuck_jobs")
def detect_stuck_jobs() -> dict:
    """Detect and fail jobs that have been processing for too long."""
    return run_async(_detect_stuck_jobs_async())


async def _detect_stuck_jobs_async() -> dict:
    from datetime import timedelta

    async with AsyncSessionFactory() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
        result = await db.execute(
            select(Job).where(
                Job.status == JobStatus.PROCESSING,
                Job.updated_at < cutoff,
            )
        )
        stuck_jobs = result.scalars().all()

        for job in stuck_jobs:
            logger.warning("stuck_job_detected", job_id=job.id, type=job.job_type)
            job.status = JobStatus.FAILED
            job.error_message = "Job timed out after 15 minutes of processing"

            # Also fail the project
            project = await _get_project(db, job.project_id)
            if project and project.status == ProjectStatus.PROCESSING:
                project.status = ProjectStatus.FAILED
                project.error_message = "Job timed out"

        await db.commit()
        return {"stuck_jobs_found": len(stuck_jobs)}


async def _get_project(db, project_id: str) -> Project | None:
    result = await db.execute(select(Project).where(Project.id == project_id))
    return result.scalar_one_or_none()


async def _get_job(db, job_id: str) -> Job | None:
    result = await db.execute(select(Job).where(Job.id == job_id))
    return result.scalar_one_or_none()

"""
ProjectService — orchestrates the complete video generation pipeline.

Manages state transitions and delegates work to Celery tasks.
"""
import json
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.config import settings
from app.core.logging_config import get_logger
from app.core.storage import storage
from app.models.project import Project, ProjectStatus, GenerationMode
from app.models.scene import Scene, SceneStatus
from app.models.job import Job, JobType, JobStatus
from app.schemas.project import ProjectCreate, DashboardStats
from app.schemas.script import ScriptSchema

logger = get_logger(__name__)

DEV_USER_ID = settings.dev_user_id


class ProjectService:

    # ── Project CRUD ───────────────────────────────────────────────────────────

    async def create_project(
        self, db: AsyncSession, data: ProjectCreate
    ) -> Project:
        resolution = data.resolution
        if data.aspect_ratio == "9:16":
            resolution = "1080x1920"
        elif data.aspect_ratio == "1:1":
            resolution = "1080x1080"
        elif data.aspect_ratio == "16:9":
            resolution = "1920x1080"

        project = Project(
            user_id=DEV_USER_ID,
            title=data.prompt[:100] + ("..." if len(data.prompt) > 100 else ""),
            prompt=data.prompt,
            duration=data.duration,
            language=data.language,
            voice_id=data.voice_id,
            video_style=data.video_style,
            image_style=data.image_style,
            aspect_ratio=data.aspect_ratio,
            resolution=resolution,
            background_music=data.background_music,
            subtitles_enabled=data.subtitles_enabled,
            subtitle_style=data.subtitle_style,
            generation_mode=data.generation_mode,
            status=ProjectStatus.DRAFT,
        )
        db.add(project)
        await db.flush()  # Get the ID without committing
        logger.info("project_created", project_id=project.id, prompt=data.prompt[:80], resolution=resolution)
        return project

    async def get_project(self, db: AsyncSession, project_id: str) -> Project | None:
        result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        return result.scalar_one_or_none()

    async def get_all_projects(self, db: AsyncSession) -> list[Project]:
        result = await db.execute(
            select(Project)
            .where(Project.user_id == DEV_USER_ID)
            .order_by(Project.created_at.desc())
        )
        return list(result.scalars().all())

    async def delete_project(self, db: AsyncSession, project_id: str) -> bool:
        project = await self.get_project(db, project_id)
        if not project:
            return False
        await db.delete(project)
        return True

    # ── Pipeline orchestration ─────────────────────────────────────────────────

    async def start_generation(self, db: AsyncSession, project: Project) -> Job:
        """Kick off the full generation pipeline by queuing the first job."""
        from app.workers.script_tasks import generate_script_task  # avoid circular

        project.status = ProjectStatus.PENDING
        project.progress = 0.0
        project.current_stage = "SCRIPT_GENERATION"

        job = Job(
            project_id=project.id,
            job_type=JobType.SCRIPT_GENERATION,
            status=JobStatus.PENDING,
        )
        db.add(job)
        await db.flush()

        # Queue Celery task
        celery_task = generate_script_task.delay(project.id, job.id)
        job.celery_task_id = celery_task.id

        logger.info(
            "generation_started",
            project_id=project.id,
            job_id=job.id,
            celery_task_id=celery_task.id,
        )
        return job

    async def approve_script(
        self, db: AsyncSession, project: Project
    ) -> Job | None:
        """After script review, kick off asset generation."""
        if project.status != ProjectStatus.AWAITING_APPROVAL:
            return None

        from app.workers.asset_tasks import generate_assets_task

        project.status = ProjectStatus.PENDING
        project.current_stage = "FLOW_IMAGE_GENERATION"

        job = Job(
            project_id=project.id,
            job_type=JobType.FLOW_IMAGE_GENERATION,
            status=JobStatus.PENDING,
        )
        db.add(job)
        await db.flush()

        celery_task = generate_assets_task.delay(project.id, job.id)
        job.celery_task_id = celery_task.id

        return job

    async def save_script_to_project(
        self,
        db: AsyncSession,
        project: Project,
        script: ScriptSchema,
    ) -> None:
        """Persist generated script data and create Scene rows."""
        project.script_data = script.model_dump()
        project.visual_style_data = (
            script.visual_style.model_dump() if script.visual_style else {}
        )
        project.title = script.title
        project.duration = script.duration

        # Remove old scenes if any
        result = await db.execute(
            select(Scene).where(Scene.project_id == project.id)
        )
        old_scenes = result.scalars().all()
        for s in old_scenes:
            await db.delete(s)

        # Create new scenes
        for scene_data in script.scenes:
            scene = Scene(
                project_id=project.id,
                scene_number=scene_data.scene_number,
                start_time=scene_data.start_time,
                end_time=scene_data.end_time,
                duration=scene_data.duration,
                narration=scene_data.narration,
                image_prompt=scene_data.image_prompt,
                video_prompt=scene_data.video_prompt,
                visual_description=scene_data.visual_description,
                status=SceneStatus.PENDING,
            )
            db.add(scene)

        # Save script JSON to storage
        script_json = json.dumps(script.model_dump(), indent=2, default=str)
        script_path = storage.script_path(project.id)
        await storage.upload_bytes(script_json.encode(), script_path, "application/json")

        logger.info(
            "script_saved",
            project_id=project.id,
            scene_count=len(script.scenes),
        )

    async def update_project_progress(
        self,
        db: AsyncSession,
        project: Project,
        progress: float,
        stage: str | None = None,
        status: ProjectStatus | None = None,
    ) -> None:
        project.progress = min(progress, 100.0)
        if stage:
            project.current_stage = stage
        if status:
            project.status = status

    async def cancel_project(self, db: AsyncSession, project: Project) -> None:
        project.status = ProjectStatus.CANCELLED
        project.current_stage = None

        # Mark pending/processing jobs as cancelled
        result = await db.execute(
            select(Job).where(
                Job.project_id == project.id,
                Job.status.in_([JobStatus.PENDING, JobStatus.PROCESSING]),
            )
        )
        for job in result.scalars().all():
            job.status = JobStatus.CANCELLED
            if job.celery_task_id:
                from app.workers.celery_app import celery_app
                celery_app.control.revoke(job.celery_task_id, terminate=True)

    # ── Dashboard stats ────────────────────────────────────────────────────────

    async def get_dashboard_stats(self, db: AsyncSession) -> DashboardStats:
        result = await db.execute(
            select(
                func.count(Project.id).label("total"),
                func.count(Project.id)
                .filter(Project.status == ProjectStatus.PROCESSING)
                .label("processing"),
                func.count(Project.id)
                .filter(Project.status == ProjectStatus.COMPLETED)
                .label("completed"),
                func.count(Project.id)
                .filter(Project.status == ProjectStatus.FAILED)
                .label("failed"),
            ).where(Project.user_id == DEV_USER_ID)
        )
        row = result.one()
        return DashboardStats(
            total_projects=row.total,
            processing_projects=row.processing,
            completed_projects=row.completed,
            failed_projects=row.failed,
            total_videos=row.completed,
        )

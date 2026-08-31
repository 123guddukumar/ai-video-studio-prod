"""
Projects API router.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.storage import storage
from app.core.config import settings
from app.models.project import Project, ProjectStatus
from app.schemas.project import (
    ProjectCreate, ProjectResponse, ProjectListResponse, DashboardStats
)
from app.schemas.scene import SceneResponse, SceneUpdate
from app.services.project_service import ProjectService

router = APIRouter(prefix="/api/projects", tags=["projects"])
project_service = ProjectService()


def _get_dev_user_id() -> str:
    return settings.dev_user_id


# ── Dashboard ──────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    return await project_service.get_dashboard_stats(db)


# ── Projects CRUD ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[ProjectListResponse])
async def list_projects(db: AsyncSession = Depends(get_db)):
    projects = await project_service.get_all_projects(db)
    return [
        ProjectListResponse(
            **{k: v for k, v in project.__dict__.items() if k != "scenes"},
            scene_count=len(project.scenes),
        )
        for project in projects
    ]


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.create_project(db, data)
    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await project_service.delete_project(db, project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")


# ── Pipeline control ───────────────────────────────────────────────────────────

@router.post("/{project_id}/generate-script")
async def generate_script(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status not in (ProjectStatus.DRAFT, ProjectStatus.FAILED):
        raise HTTPException(
            status_code=409,
            detail=f"Project is in state '{project.status}', cannot restart generation.",
        )
    job = await project_service.start_generation(db, project)
    await db.commit()
    return {"message": "Script generation started", "job_id": job.id}


@router.post("/{project_id}/approve-script")
async def approve_script(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    job = await project_service.approve_script(db, project)
    if not job:
        raise HTTPException(
            status_code=409,
            detail="Project is not awaiting script approval",
        )
    await db.commit()
    return {"message": "Script approved, asset generation started", "job_id": job.id}


@router.post("/{project_id}/generate-assets")
async def generate_assets(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger asset generation (after script is ready)."""
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.script_data:
        raise HTTPException(status_code=409, detail="Script not generated yet")

    from app.models.job import Job, JobType, JobStatus
    from app.workers.asset_tasks import generate_assets_task

    job = Job(
        project_id=project_id,
        job_type=JobType.FLOW_IMAGE_GENERATION,
        status=JobStatus.PENDING,
    )
    db.add(job)
    await db.flush()
    await db.commit()

    celery_task = generate_assets_task.delay(project_id, job.id)
    job.celery_task_id = celery_task.id
    await db.commit()

    return {"message": "Asset generation started", "job_id": job.id}


@router.post("/{project_id}/generate-voice")
async def generate_voice(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    from app.models.job import Job, JobType, JobStatus
    from app.workers.voice_tasks import generate_voice_task

    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    job = Job(
        project_id=project_id,
        job_type=JobType.ELEVENLABS_GENERATION,
        status=JobStatus.PENDING,
    )
    db.add(job)
    await db.flush()
    await db.commit()

    celery_task = generate_voice_task.delay(project_id, job.id)
    job.celery_task_id = celery_task.id
    await db.commit()

    return {"message": "Voice generation started", "job_id": job.id}


@router.post("/{project_id}/render")
async def render_video(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    from app.models.job import Job, JobType, JobStatus
    from app.workers.video_tasks import compose_video_task

    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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

    return {"message": "Video render started", "job_id": job.id}


@router.post("/{project_id}/cancel")
async def cancel_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await project_service.cancel_project(db, project)
    await db.commit()
    return {"message": "Project cancelled"}


@router.get("/{project_id}/status")
async def get_project_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "project_id": project.id,
        "status": project.status,
        "progress": project.progress,
        "current_stage": project.current_stage,
        "error_message": project.error_message,
        "final_video_url": project.final_video_url,
    }


@router.get("/{project_id}/download")
async def download_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.final_video_url:
        raise HTTPException(status_code=404, detail="Final video not yet generated")
    return {"download_url": project.final_video_url}


@router.post("/{project_id}/reference-image")
async def upload_reference_image(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    content = await file.read()
    ref_path = f"{project_id}/reference_image.png"
    await storage.upload_bytes(content, ref_path, file.content_type)
    
    return {"status": "success", "filename": "reference_image.png"}


@router.post("/{project_id}/retry")
async def retry_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from app.models.job import Job, JobType, JobStatus
    from app.models.scene import Scene, SceneStatus
    import logging

    logger = logging.getLogger(__name__)

    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status != ProjectStatus.FAILED:
        raise HTTPException(
            status_code=400,
            detail=f"Project is in status '{project.status}', only failed projects can be retried."
        )

    stage = project.current_stage or "SCRIPT_GENERATION"
    logger.info(f"Retrying failed project {project_id} from stage {stage}")

    # Reset project status
    project.status = ProjectStatus.PROCESSING
    project.error_message = None
    await db.commit()

    if stage in ("SCRIPT_GENERATION", "AWAITING_SCRIPT_APPROVAL"):
        job = await project_service.start_generation(db, project)
        await db.commit()
        return {"message": "Retrying script generation", "stage": stage, "job_id": job.id}

    elif stage in ("FLOW_IMAGE_GENERATION", "FLOW_VIDEO_GENERATION"):
        result_scenes = await db.execute(
            select(Scene).where(Scene.project_id == project_id)
        )
        scenes = result_scenes.scalars().all()
        for scene in scenes:
            if scene.status == SceneStatus.FLOW_AUTOMATION_ERROR:
                scene.status = SceneStatus.PENDING
                scene.error_message = None
        await db.commit()

        from app.workers.asset_tasks import generate_assets_task
        job = Job(
            project_id=project_id,
            job_type=JobType.FLOW_IMAGE_GENERATION,
            status=JobStatus.PENDING,
        )
        db.add(job)
        await db.flush()
        await db.commit()

        celery_task = generate_assets_task.delay(project_id, job.id)
        job.celery_task_id = celery_task.id
        await db.commit()
        return {"message": "Retrying asset generation", "stage": stage, "job_id": job.id}

    elif stage in ("VOICE_GENERATION", "ELEVENLABS_GENERATION"):
        from app.workers.voice_tasks import generate_voice_task
        job = Job(
            project_id=project_id,
            job_type=JobType.ELEVENLABS_GENERATION,
            status=JobStatus.PENDING,
        )
        db.add(job)
        await db.flush()
        await db.commit()

        celery_task = generate_voice_task.delay(project_id, job.id)
        job.celery_task_id = celery_task.id
        await db.commit()
        return {"message": "Retrying voice generation", "stage": stage, "job_id": job.id}

    elif stage in ("VIDEO_EDITING", "VIDEO_COMPOSITION", "FINAL_VIDEO_COMPILATION"):
        from app.workers.video_tasks import compose_video_task
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
        return {"message": "Retrying video rendering", "stage": stage, "job_id": job.id}

    else:
        job = await project_service.start_generation(db, project)
        await db.commit()
        return {"message": "Restarted pipeline from script generation", "stage": stage, "job_id": job.id}

"""
Scenes API router.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.scene import Scene
from app.schemas.scene import SceneResponse, SceneUpdate

router = APIRouter(prefix="/api/scenes", tags=["scenes"])


@router.get("/{scene_id}", response_model=SceneResponse)
async def get_scene(scene_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Scene).where(Scene.id == scene_id))
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return SceneResponse.model_validate(scene)


@router.patch("/{scene_id}", response_model=SceneResponse)
async def update_scene(
    scene_id: str,
    data: SceneUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update scene prompts/narration (for the script editor)."""
    result = await db.execute(select(Scene).where(Scene.id == scene_id))
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    if data.narration is not None:
        scene.narration = data.narration
    if data.image_prompt is not None:
        scene.image_prompt = data.image_prompt
    if data.video_prompt is not None:
        scene.video_prompt = data.video_prompt
    if data.visual_description is not None:
        scene.visual_description = data.visual_description

    await db.commit()
    await db.refresh(scene)
    return SceneResponse.model_validate(scene)


@router.post("/{scene_id}/regenerate-image")
async def regenerate_scene_image(scene_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Scene).where(Scene.id == scene_id))
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    from app.workers.asset_tasks import regenerate_scene_image_task
    celery_task = regenerate_scene_image_task.delay(scene.project_id, scene_id)
    return {"message": "Image regeneration started", "task_id": celery_task.id}


@router.post("/{scene_id}/regenerate-video")
async def regenerate_scene_video(scene_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Scene).where(Scene.id == scene_id))
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    from app.workers.asset_tasks import regenerate_scene_video_task
    celery_task = regenerate_scene_video_task.delay(scene.project_id, scene_id)
    return {"message": "Video regeneration started", "task_id": celery_task.id}


@router.post("/{scene_id}/regenerate-prompts")
async def regenerate_scene_prompts(scene_id: str, db: AsyncSession = Depends(get_db)):
    """Regenerate AI prompts for a scene using the current narration."""
    result = await db.execute(select(Scene).where(Scene.id == scene_id))
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    # Get project for visual style
    from sqlalchemy import select as sel
    from app.models.project import Project
    proj_result = await db.execute(sel(Project).where(Project.id == scene.project_id))
    project = proj_result.scalar_one_or_none()

    from app.services.script_service import ScriptService
    svc = ScriptService()
    new_prompts = await svc.regenerate_scene_prompts(
        project_id=scene.project_id,
        scene_number=scene.scene_number,
        narration=scene.narration,
        visual_style=project.visual_style_data or {},
        duration=scene.duration,
    )

    scene.image_prompt = new_prompts["image_prompt"]
    scene.video_prompt = new_prompts["video_prompt"]
    scene.visual_description = new_prompts.get("visual_description")
    await db.commit()
    await db.refresh(scene)

    return SceneResponse.model_validate(scene)

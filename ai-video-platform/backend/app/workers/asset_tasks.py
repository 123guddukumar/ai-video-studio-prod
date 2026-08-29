"""
Asset generation Celery tasks — delegates to the Flow Worker microservice.
"""
import asyncio

import httpx
from celery import Task
from sqlalchemy import select

from app.workers.celery_app import celery_app
from app.core.config import settings
from app.core.logging_config import get_logger
from app.core.database import AsyncSessionFactory
from app.models.project import Project, ProjectStatus, GenerationMode
from app.models.scene import Scene, SceneStatus
from app.models.job import Job, JobType, JobStatus
from app.services.websocket_manager import ws_manager

logger = get_logger(__name__)


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="app.workers.asset_tasks.generate_assets_task", max_retries=2)
def generate_assets_task(self: Task, project_id: str, job_id: str) -> dict:
    """Trigger the flow-worker to generate images and videos for all scenes."""
    return run_async(_generate_assets_async(self, project_id, job_id))


async def _generate_assets_async(task: Task, project_id: str, job_id: str) -> dict:
    async with AsyncSessionFactory() as db:
        project = await _get_project(db, project_id)
        job = await _get_job(db, job_id)

        if not project or not job:
            return {"error": "not_found"}

        try:
            job.status = JobStatus.PROCESSING
            project.status = ProjectStatus.PROCESSING
            project.current_stage = "FLOW_IMAGE_GENERATION"
            await db.commit()

            # Get scenes
            result = await db.execute(
                select(Scene)
                .where(Scene.project_id == project_id)
                .order_by(Scene.scene_number)
            )
            scenes = list(result.scalars().all())
            total_scenes = len(scenes)

            await ws_manager.broadcast_progress(
                project_id=project_id,
                stage="FLOW_IMAGE_GENERATION",
                progress=15.0,
                status="processing",
                extra={"total_scenes": total_scenes, "message": "Starting asset generation..."},
            )

            # ── Phase 1: Generate Images for All Scenes ─────────────────────────
            project.current_stage = "FLOW_IMAGE_GENERATION"
            await db.commit()

            image_completed = 0
            for scene in scenes:
                # Skip already completed images (resume support)
                if scene.image_status == SceneStatus.COMPLETED:
                    image_completed += 1
                    continue

                logger.info(
                    "flow_image_generation_started",
                    project_id=project_id,
                    scene_number=scene.scene_number,
                )

                scene.status = SceneStatus.PROCESSING
                scene.image_status = SceneStatus.PROCESSING
                await db.commit()

                await ws_manager.broadcast_progress(
                    project_id=project_id,
                    stage="FLOW_IMAGE_GENERATION",
                    progress=15.0 + (image_completed / total_scenes) * 20.0,
                    status="processing",
                    extra={
                        "current_scene": scene.scene_number,
                        "total_scenes": total_scenes,
                        "message": f"Generating Image for Scene {scene.scene_number} of {total_scenes}...",
                    },
                )

                # Check for reference image flag in prompt
                use_ref_image = scene.image_prompt.startswith("[USE_REF_IMAGE]")
                clean_image_prompt = scene.image_prompt
                image_url = None
                
                if use_ref_image:
                    clean_image_prompt = scene.image_prompt.replace("[USE_REF_IMAGE]", "").strip()
                    from app.core.storage import storage
                    ref_image_path = f"{project_id}/reference_image.png"
                    if await storage.file_exists(ref_image_path):
                        local_path = storage.get_local_path(ref_image_path)
                        import base64
                        import aiofiles
                        try:
                            async with aiofiles.open(local_path, "rb") as f:
                                img_bytes = await f.read()
                            img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                            image_url = f"data:image/png;base64,{img_b64}"
                            logger.info("loaded_reference_image_for_scene", project_id=project_id, scene_number=scene.scene_number)
                        except Exception as e:
                            logger.error("failed_to_encode_ref_image", project_id=project_id, error=str(e))

                # Call flow-worker image-only API
                success = await _call_flow_image_only(
                    project_id=project_id,
                    scene_id=scene.id,
                    scene_number=scene.scene_number,
                    image_prompt=clean_image_prompt,
                    aspect_ratio=project.aspect_ratio or "16:9",
                    image_url=image_url,
                )

                if success:
                    scene.image_status = SceneStatus.COMPLETED
                    
                    # Register generated Image in database
                    from app.models.asset import Asset, AssetType, AssetStatus
                    from app.core.storage import storage
                    
                    img_rel_path = storage.scene_path(project_id, scene.scene_number, "image.png")
                    img_public_url = storage.get_public_url(img_rel_path)
                    img_result = await db.execute(
                        select(Asset).where(Asset.scene_id == scene.id, Asset.asset_type == AssetType.IMAGE)
                    )
                    img_asset = img_result.scalars().first()
                    if not img_asset:
                        img_asset = Asset(
                            scene_id=scene.id,
                            project_id=project_id,
                            asset_type=AssetType.IMAGE,
                        )
                        db.add(img_asset)
                    img_asset.status = AssetStatus.COMPLETED
                    img_asset.storage_path = img_rel_path
                    img_asset.public_url = img_public_url
                    
                    image_completed += 1
                else:
                    scene.status = SceneStatus.FLOW_AUTOMATION_ERROR
                    scene.image_status = SceneStatus.FAILED
                    scene.error_message = "Flow worker image generation failed"
                    logger.error(
                        "flow_image_generation_failed",
                        project_id=project_id,
                        scene_number=scene.scene_number,
                    )

                await db.commit()

            # Check if any scene image generation failed
            failed_images = [s for s in scenes if s.image_status == SceneStatus.FAILED]
            if failed_images:
                raise RuntimeError(f"{len(failed_images)} scene image generation tasks failed. Aborting video rendering.")

            # ── Phase 2: Generate Videos from Images for All Scenes ──────────────
            project.current_stage = "FLOW_VIDEO_GENERATION"
            await db.commit()

            video_completed = 0
            for scene in scenes:
                # Skip already completed videos (resume support)
                if scene.video_status == SceneStatus.COMPLETED:
                    video_completed += 1
                    continue

                logger.info(
                    "flow_video_generation_started",
                    project_id=project_id,
                    scene_number=scene.scene_number,
                )

                scene.status = SceneStatus.PROCESSING
                scene.video_status = SceneStatus.PROCESSING
                await db.commit()

                await ws_manager.broadcast_progress(
                    project_id=project_id,
                    stage="FLOW_VIDEO_GENERATION",
                    progress=35.0 + (video_completed / total_scenes) * 25.0,
                    status="processing",
                    extra={
                        "current_scene": scene.scene_number,
                        "total_scenes": total_scenes,
                        "message": f"Generating Video for Scene {scene.scene_number} of {total_scenes}...",
                    },
                )

                # Fetch generated image to pass as reference base64
                from app.core.storage import storage
                img_rel_path = storage.scene_path(project_id, scene.scene_number, "image.png")
                local_img_path = storage.get_local_path(img_rel_path)
                image_url = None
                
                if await storage.file_exists(img_rel_path):
                    import base64
                    import aiofiles
                    try:
                        async with aiofiles.open(local_img_path, "rb") as f:
                            img_bytes = await f.read()
                        img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                        image_url = f"data:image/png;base64,{img_b64}"
                    except Exception as e:
                        logger.error(
                            "failed_to_encode_scene_image_for_video_ref",
                            project_id=project_id,
                            scene_number=scene.scene_number,
                            error=str(e)
                        )

                # Call flow-worker video-only API
                success = await _call_flow_video_only(
                    project_id=project_id,
                    scene_id=scene.id,
                    scene_number=scene.scene_number,
                    video_prompt=scene.video_prompt,
                    duration=scene.duration,
                    aspect_ratio=project.aspect_ratio or "16:9",
                    image_url=image_url,
                )

                if success:
                    scene.status = SceneStatus.COMPLETED
                    scene.video_status = SceneStatus.COMPLETED
                    
                    # Register generated Video in database
                    from app.models.asset import Asset, AssetType, AssetStatus
                    
                    vid_rel_path = storage.scene_path(project_id, scene.scene_number, "video.mp4")
                    vid_public_url = storage.get_public_url(vid_rel_path)
                    vid_result = await db.execute(
                        select(Asset).where(Asset.scene_id == scene.id, Asset.asset_type == AssetType.VIDEO)
                    )
                    vid_asset = vid_result.scalars().first()
                    if not vid_asset:
                        vid_asset = Asset(
                            scene_id=scene.id,
                            project_id=project_id,
                            asset_type=AssetType.VIDEO,
                        )
                        db.add(vid_asset)
                    vid_asset.status = AssetStatus.COMPLETED
                    vid_asset.storage_path = vid_rel_path
                    vid_asset.public_url = vid_public_url
                    
                    video_completed += 1
                else:
                    scene.status = SceneStatus.FLOW_AUTOMATION_ERROR
                    scene.video_status = SceneStatus.FAILED
                    scene.error_message = "Flow worker video generation failed"
                    logger.error(
                        "flow_video_generation_failed",
                        project_id=project_id,
                        scene_number=scene.scene_number,
                    )

                await db.commit()

            # All scenes done — move to voice generation
            job.status = JobStatus.COMPLETED
            job.progress = 100.0

            # Check if any scenes failed video rendering
            failed_videos = [s for s in scenes if s.video_status == SceneStatus.FAILED]
            if failed_videos:
                logger.warning(
                    "some_scenes_failed_video_generation",
                    project_id=project_id,
                    failed_count=len(failed_videos),
                )

            await db.commit()
            await _queue_voice_generation(db, project_id)

            return {"status": "completed", "total_scenes": total_scenes, "completed": video_completed}

        except Exception as exc:
            logger.error("asset_generation_failed", project_id=project_id, error=str(exc))
            job.status = JobStatus.FAILED
            job.error_message = str(exc)
            project.status = ProjectStatus.FAILED
            project.error_message = f"Asset generation failed: {exc}"
            await db.commit()
            await ws_manager.broadcast_error(project_id, "FLOW_IMAGE_GENERATION", str(exc))
            raise


async def _call_flow_image_only(
    project_id: str,
    scene_id: str,
    scene_number: int,
    image_prompt: str,
    aspect_ratio: str = "16:9",
    image_url: str | None = None,
) -> bool:
    """Call the Flow Worker HTTP API to generate only the image for a scene."""
    url = f"{settings.flow_worker_url}/generate/image"
    payload = {
        "project_id": project_id,
        "scene_id": scene_id,
        "scene_number": scene_number,
        "image_prompt": image_prompt,
        "aspect_ratio": aspect_ratio,
        "image_url": image_url,
    }
    try:
        async with httpx.AsyncClient(timeout=settings.flow_timeout_seconds) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                return data.get("success", False)
            else:
                logger.error(
                    "flow_worker_image_http_error",
                    scene_number=scene_number,
                    status_code=response.status_code,
                    body=response.text[:200],
                )
                return False
    except Exception as e:
        logger.error("flow_worker_image_call_failed", scene_number=scene_number, error=str(e))
        return False


async def _call_flow_video_only(
    project_id: str,
    scene_id: str,
    scene_number: int,
    video_prompt: str,
    duration: int,
    aspect_ratio: str = "16:9",
    image_url: str | None = None,
) -> bool:
    """Call the Flow Worker HTTP API to generate only the video for a scene."""
    url = f"{settings.flow_worker_url}/generate/video"
    payload = {
        "project_id": project_id,
        "scene_id": scene_id,
        "scene_number": scene_number,
        "video_prompt": video_prompt,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "image_url": image_url,
    }
    try:
        async with httpx.AsyncClient(timeout=settings.flow_timeout_seconds) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                return data.get("success", False)
            else:
                logger.error(
                    "flow_worker_video_http_error",
                    scene_number=scene_number,
                    status_code=response.status_code,
                    body=response.text[:200],
                )
                return False
    except Exception as e:
        logger.error("flow_worker_video_call_failed", scene_number=scene_number, error=str(e))
        return False


@celery_app.task(bind=True, name="app.workers.asset_tasks.regenerate_scene_image_task")
def regenerate_scene_image_task(self: Task, project_id: str, scene_id: str) -> dict:
    """Regenerate image for a single scene."""
    return run_async(_regenerate_scene_image_async(project_id, scene_id))


@celery_app.task(bind=True, name="app.workers.asset_tasks.regenerate_scene_video_task")
def regenerate_scene_video_task(self: Task, project_id: str, scene_id: str) -> dict:
    """Regenerate video for a single scene."""
    return run_async(_regenerate_scene_video_async(project_id, scene_id))


async def _regenerate_scene_image_async(project_id: str, scene_id: str) -> dict:
    async with AsyncSessionFactory() as db:
        result = await db.execute(select(Scene).where(Scene.id == scene_id))
        scene = result.scalar_one_or_none()
        if not scene:
            return {"error": "scene_not_found"}

        # Get aspect_ratio from Project
        proj_result = await db.execute(select(Project.aspect_ratio).where(Project.id == project_id))
        aspect_ratio = proj_result.scalar_one_or_none() or "16:9"

        scene.image_status = SceneStatus.PROCESSING
        await db.commit()

        url = f"{settings.flow_worker_url}/generate/image"
        payload = {
            "project_id": project_id,
            "scene_id": scene_id,
            "scene_number": scene.scene_number,
            "image_prompt": scene.image_prompt,
            "aspect_ratio": aspect_ratio,
        }
        try:
            async with httpx.AsyncClient(timeout=settings.flow_timeout_seconds) as client:
                response = await client.post(url, json=payload)
                success = response.status_code == 200 and response.json().get("success", False)
        except Exception as e:
            success = False
            scene.error_message = str(e)

        if success:
            scene.image_status = SceneStatus.COMPLETED
            
            # Register generated asset in database so it shows in UI
            from app.models.asset import Asset, AssetType, AssetStatus
            from app.core.storage import storage
            
            img_rel_path = storage.scene_path(project_id, scene.scene_number, "image.png")
            img_public_url = storage.get_public_url(img_rel_path)
            img_result = await db.execute(
                select(Asset).where(Asset.scene_id == scene.id, Asset.asset_type == AssetType.IMAGE)
            )
            img_asset = img_result.scalars().first()
            if not img_asset:
                img_asset = Asset(
                    scene_id=scene.id,
                    project_id=project_id,
                    asset_type=AssetType.IMAGE,
                )
                db.add(img_asset)
            img_asset.status = AssetStatus.COMPLETED
            img_asset.storage_path = img_rel_path
            img_asset.public_url = img_public_url
        else:
            scene.image_status = SceneStatus.FAILED
            
        await db.commit()
        return {"success": success}


async def _regenerate_scene_video_async(project_id: str, scene_id: str) -> dict:
    async with AsyncSessionFactory() as db:
        result = await db.execute(select(Scene).where(Scene.id == scene_id))
        scene = result.scalar_one_or_none()
        if not scene:
            return {"error": "scene_not_found"}

        # Get aspect_ratio from Project
        proj_result = await db.execute(select(Project.aspect_ratio).where(Project.id == project_id))
        aspect_ratio = proj_result.scalar_one_or_none() or "16:9"

        scene.video_status = SceneStatus.PROCESSING
        await db.commit()

        url = f"{settings.flow_worker_url}/generate/video"
        payload = {
            "project_id": project_id,
            "scene_id": scene_id,
            "scene_number": scene.scene_number,
            "video_prompt": scene.video_prompt,
            "duration": scene.duration,
            "aspect_ratio": aspect_ratio,
        }
        try:
            async with httpx.AsyncClient(timeout=settings.flow_timeout_seconds) as client:
                response = await client.post(url, json=payload)
                success = response.status_code == 200 and response.json().get("success", False)
        except Exception as e:
            success = False
            scene.error_message = str(e)

        if success:
            scene.video_status = SceneStatus.COMPLETED
            
            # Register generated asset in database so it shows in UI
            from app.models.asset import Asset, AssetType, AssetStatus
            from app.core.storage import storage
            
            vid_rel_path = storage.scene_path(project_id, scene.scene_number, "video.mp4")
            vid_public_url = storage.get_public_url(vid_rel_path)
            vid_result = await db.execute(
                select(Asset).where(Asset.scene_id == scene.id, Asset.asset_type == AssetType.VIDEO)
            )
            vid_asset = vid_result.scalars().first()
            if not vid_asset:
                vid_asset = Asset(
                    scene_id=scene.id,
                    project_id=project_id,
                    asset_type=AssetType.VIDEO,
                )
                db.add(vid_asset)
            vid_asset.status = AssetStatus.COMPLETED
            vid_asset.storage_path = vid_rel_path
            vid_asset.public_url = vid_public_url
        else:
            scene.video_status = SceneStatus.FAILED
            
        await db.commit()
        return {"success": success}


async def _queue_voice_generation(db, project_id: str) -> None:
    from app.workers.voice_tasks import generate_voice_task
    from app.models.project import Project

    project = await _get_project(db, project_id)
    if not project:
        return

    project.current_stage = "ELEVENLABS_GENERATION"

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


async def _get_project(db, project_id: str):
    result = await db.execute(select(Project).where(Project.id == project_id))
    return result.scalar_one_or_none()


async def _get_job(db, job_id: str):
    result = await db.execute(select(Job).where(Job.id == job_id))
    return result.scalar_one_or_none()

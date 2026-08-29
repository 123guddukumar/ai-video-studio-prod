"""
Flow Worker main entry — FastAPI server that receives generation requests
from the backend Celery worker and runs Playwright automation.
"""
import asyncio
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from pydantic import BaseModel

from browser import browser_manager
from image_generator import ImageGenerator
from video_generator import VideoGenerator
from downloader import Downloader
from logging_setup import configure_logging, get_logger
import flow_selectors as S

configure_logging()
logger = get_logger(__name__)

STORAGE_BASE = Path("/app/storage/projects")


class ExtensionManager:
    """Manages active Chrome Extension connections and task states."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.active_tasks: Dict[str, asyncio.Event] = {}
        self.task_results: Dict[str, dict] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("extension_connected", client=websocket.client)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("extension_disconnected")

    @property
    def is_connected(self) -> bool:
        return len(self.active_connections) > 0

    async def send_task(self, task_data: dict) -> dict:
        """Send a task to the extension and wait for it to complete."""
        if not self.is_connected:
            raise RuntimeError("No extension connected")

        task_id = task_data["task_id"]
        event = asyncio.Event()
        self.active_tasks[task_id] = event
        self.task_results[task_id] = {"success": False, "error": "Connection lost or timeout"}

        # Route to the first connected extension client
        websocket = self.active_connections[0]
        try:
            await websocket.send_json(task_data)
            logger.info("task_sent_to_extension", task_id=task_id)
        except Exception as e:
            logger.error("failed_to_send_task_to_extension", task_id=task_id, error=str(e))
            self.active_tasks.pop(task_id, None)
            self.task_results.pop(task_id, None)
            raise RuntimeError(f"Failed to communicate with extension: {e}")

        # Wait for the task to be completed (max 8 minutes)
        try:
            await asyncio.wait_for(event.wait(), timeout=480.0)
            result = self.task_results.get(task_id, {"success": False, "error": "Unknown failure"})
            return result
        except asyncio.TimeoutError:
            logger.error("task_timeout_extension", task_id=task_id)
            return {"success": False, "error": "Extension task execution timed out"}
        finally:
            self.active_tasks.pop(task_id, None)
            self.task_results.pop(task_id, None)

    def complete_task(self, task_id: str, success: bool, error: str = ""):
        if task_id in self.active_tasks:
            self.task_results[task_id] = {"success": success, "error": error}
            self.active_tasks[task_id].set()
            logger.info("task_completed_by_extension", task_id=task_id, success=success, error=error)


extension_manager = ExtensionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("flow_worker_starting")
    # Browser starts lazily on first request — this avoids blocking startup
    # when the Google Chrome session hasn't been set up yet.
    logger.info(
        "flow_worker_ready",
        note="Browser starts lazily on first /generate request. "
             "Run 'docker exec aivp-flow-worker python -c "
             "\"import asyncio; from browser import browser_manager; "
             "asyncio.run(browser_manager.start())\"' to pre-warm.",
    )

    yield

    logger.info("flow_worker_stopping")
    if browser_manager._context is not None:
        await browser_manager.stop()


app = FastAPI(title="Flow Worker", version="1.0.0", lifespan=lifespan)


class SceneGenerationRequest(BaseModel):
    project_id: str
    scene_id: str
    scene_number: int
    image_prompt: str
    video_prompt: str
    duration: int
    aspect_ratio: str = "16:9"
    image_url: Optional[str] = None


class ImageGenerationRequest(BaseModel):
    project_id: str
    scene_id: str
    scene_number: int
    image_prompt: str
    aspect_ratio: str = "16:9"


class VideoGenerationRequest(BaseModel):
    project_id: str
    scene_id: str
    scene_number: int
    video_prompt: str
    duration: int
    aspect_ratio: str = "16:9"
    image_url: Optional[str] = None


async def prepare_tab(project_id: str, scene_number: int):
    # Ensure browser is started lazily
    if not browser_manager._page:
        await browser_manager.start()

    page = await browser_manager.new_tab()
    try:
        logger.info("[FLOW] Navigating new tab to Google Flow", url=S.FLOW_URL, scene=scene_number)
        await page.goto(
            S.FLOW_URL,
            wait_until="domcontentloaded",
            timeout=S.PAGE_LOAD_TIMEOUT,
        )
        
        # Verify authenticated state on this tab
        try:
            await page.wait_for_selector(S.AUTH_INDICATOR, timeout=5000)
        except Exception:
            try:
                await page.wait_for_selector(S.SESSION_EXPIRED, timeout=2000)
                raise HTTPException(status_code=503, detail="Google Flow session has expired or login required.")
            except Exception:
                pass
                
        return page
    except Exception as e:
        await page.close()
        logger.error("[FLOW] Failed to prepare tab", error=str(e), scene=scene_number)
        raise HTTPException(status_code=503, detail=f"Google Flow navigation failed: {e}")


@app.websocket("/extension/ws")
async def extension_websocket_endpoint(websocket: WebSocket):
    await extension_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            
            # Respond to ping heartbeats
            if data.get("type") == "PING":
                await websocket.send_json({"type": "PING"})
            elif data.get("type") == "PONG":
                pass
            elif data.get("type") == "LOG":
                logger.info(f"[EXTENSION] [{data.get('level', 'INFO').upper()}] {data.get('text')}")
            elif data.get("type") == "TASK_COMPLETE":
                task_id = data.get("task_id")
                success = data.get("success", False)
                error = data.get("error", "")
                extension_manager.complete_task(task_id, success, error)
                
    except WebSocketDisconnect:
        extension_manager.disconnect(websocket)
    except Exception as e:
        logger.error("websocket_exception", error=str(e))
        extension_manager.disconnect(websocket)


@app.post("/extension/upload")
async def extension_upload(
    file: UploadFile = File(...),
    task_id: str = Form(...),
    project_id: str = Form(...),
    scene_number: str = Form(...),
    file_type: str = Form(...)  # "image" or "video"
):
    logger.info(
        "extension_upload_received",
        task_id=task_id,
        project_id=project_id,
        scene_number=scene_number,
        file_type=file_type,
        filename=file.filename
    )
    
    try:
        scene_num = int(scene_number)
        scene_dir = STORAGE_BASE / project_id / "scenes" / f"scene_{scene_num:03d}"
        scene_dir.mkdir(parents=True, exist_ok=True)
        
        filename = "image.png" if file_type == "image" else "video.mp4"
        file_path = scene_dir / filename
        
        # Save file to projects folder
        contents = await file.read()
        file_path.write_bytes(contents)
        
        logger.info("extension_uploaded_file_saved", path=str(file_path))
        return {"success": True, "path": str(file_path)}
        
    except Exception as e:
        logger.error("extension_upload_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")


@app.post("/generate/scene")
async def generate_scene(req: SceneGenerationRequest):
    """Generate both image and video for a scene. Routes to extension if connected, else falls back to Playwright."""
    logger.info(
        "[FLOW] scene_generation_request",
        project_id=req.project_id,
        scene=req.scene_number,
    )

    scene_dir = STORAGE_BASE / req.project_id / "scenes" / f"scene_{req.scene_number:03d}"
    scene_dir.mkdir(parents=True, exist_ok=True)

    image_path = scene_dir / "image.png"
    video_path = scene_dir / "video.mp4"

    # Route through Chrome Extension if connected
    if extension_manager.is_connected:
        logger.info("[FLOW] Routing scene generation request through Chrome Extension", scene=req.scene_number)
        task_id = str(uuid.uuid4())
        task_data = {
            "type": "TASK_START",
            "task_id": task_id,
            "project_id": req.project_id,
            "scene_number": req.scene_number,
            "action": "generate_scene",
            "image_prompt": req.image_prompt,
            "video_prompt": req.video_prompt,
            "duration": req.duration,
            "aspect_ratio": req.aspect_ratio,
            "image_url": req.image_url
        }
        
        result = await extension_manager.send_task(task_data)
        success = result.get("success", False)
        
        if not success:
            try:
                await browser_manager.take_screenshot(
                    f"scene_{req.scene_number}_extension_failure",
                    req.project_id
                )
            except Exception as se:
                logger.error("failed_to_take_extension_failure_screenshot", error=str(se))
        
        return {
            "success": success,
            "scene_number": req.scene_number,
            "image_path": str(image_path) if success and image_path.exists() else None,
            "video_path": str(video_path) if success and video_path.exists() else None,
            "error": result.get("error") if not success else None
        }

    # Fallback to local Playwright automation
    logger.info("[FLOW] Routing scene generation request through Playwright fallback", scene=req.scene_number)
    page = await prepare_tab(req.project_id, req.scene_number)
    try:
        downloader = Downloader()
        image_gen = ImageGenerator(page, downloader)
        video_gen = VideoGenerator(page, downloader)

        # Generate image
        image_success = await image_gen.generate(
            project_id=req.project_id,
            scene_number=req.scene_number,
            image_prompt=req.image_prompt,
            output_path=image_path,
            aspect_ratio=req.aspect_ratio,
        )

        if not image_success:
            logger.error("[FLOW] image_generation_failed", scene=req.scene_number)
            return {
                "success": False,
                "scene_number": req.scene_number,
                "error": "Image generation failed",
                "error_code": "FLOW_AUTOMATION_ERROR",
            }

        # Generate video
        video_success = await video_gen.generate(
            project_id=req.project_id,
            scene_number=req.scene_number,
            video_prompt=req.video_prompt,
            duration=req.duration,
            output_path=video_path,
            reference_image_path=image_path if image_path.exists() else None,
            aspect_ratio=req.aspect_ratio,
        )

        success = image_success and video_success

        logger.info(
            "[FLOW] scene_generation_completed",
            scene=req.scene_number,
            success=success,
            image=str(image_path),
            video=str(video_path),
        )

        return {
            "success": success,
            "scene_number": req.scene_number,
            "image_path": str(image_path) if image_path.exists() else None,
            "video_path": str(video_path) if video_path.exists() else None,
        }
    finally:
        await page.close()
        logger.info("[FLOW] Closed new tab for scene", scene=req.scene_number)


@app.post("/generate/image")
async def generate_image_only(req: ImageGenerationRequest):
    scene_dir = STORAGE_BASE / req.project_id / "scenes" / f"scene_{req.scene_number:03d}"
    scene_dir.mkdir(parents=True, exist_ok=True)
    image_path = scene_dir / "image.png"

    # Route through Chrome Extension if connected
    if extension_manager.is_connected:
        logger.info("[FLOW] Routing image generation request through Chrome Extension", scene=req.scene_number)
        task_id = str(uuid.uuid4())
        task_data = {
            "type": "TASK_START",
            "task_id": task_id,
            "project_id": req.project_id,
            "scene_number": req.scene_number,
            "action": "generate_image",
            "image_prompt": req.image_prompt,
            "aspect_ratio": req.aspect_ratio
        }
        
        result = await extension_manager.send_task(task_data)
        success = result.get("success", False)
        
        return {
            "success": success,
            "image_path": str(image_path) if success and image_path.exists() else None,
            "error": result.get("error") if not success else None
        }

    # Fallback to local Playwright automation
    logger.info("[FLOW] Routing image generation request through Playwright fallback", scene=req.scene_number)
    page = await prepare_tab(req.project_id, req.scene_number)
    try:
        downloader = Downloader()
        image_gen = ImageGenerator(page, downloader)

        success = await image_gen.generate(
            project_id=req.project_id,
            scene_number=req.scene_number,
            image_prompt=req.image_prompt,
            output_path=image_path,
            aspect_ratio=req.aspect_ratio,
        )
        return {"success": success, "image_path": str(image_path) if success else None}
    finally:
        await page.close()
        logger.info("[FLOW] Closed new tab for image-only generation", scene=req.scene_number)


@app.post("/generate/video")
async def generate_video_only(req: VideoGenerationRequest):
    scene_dir = STORAGE_BASE / req.project_id / "scenes" / f"scene_{req.scene_number:03d}"
    scene_dir.mkdir(parents=True, exist_ok=True)
    video_path = scene_dir / "video.mp4"
    image_path = scene_dir / "image.png"

    # Route through Chrome Extension if connected
    if extension_manager.is_connected:
        logger.info("[FLOW] Routing video generation request through Chrome Extension", scene=req.scene_number)
        task_id = str(uuid.uuid4())
        
        # If image_url is not provided but image.png exists locally, load as base64
        image_url = req.image_url
        if not image_url and image_path.exists():
            import base64
            try:
                with open(image_path, "rb") as f:
                    img_bytes = f.read()
                img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                image_url = f"data:image/png;base64,{img_b64}"
            except Exception as e:
                logger.error("failed_to_encode_local_image_for_extension_task", scene=req.scene_number, error=str(e))

        task_data = {
            "type": "TASK_START",
            "task_id": task_id,
            "project_id": req.project_id,
            "scene_number": req.scene_number,
            "action": "generate_video",
            "video_prompt": req.video_prompt,
            "duration": req.duration,
            "aspect_ratio": req.aspect_ratio,
            "image_url": image_url
        }
        
        result = await extension_manager.send_task(task_data)
        success = result.get("success", False)
        
        return {
            "success": success,
            "video_path": str(video_path) if success and video_path.exists() else None,
            "error": result.get("error") if not success else None
        }

    # Fallback to local Playwright automation
    logger.info("[FLOW] Routing video generation request through Playwright fallback", scene=req.scene_number)
    page = await prepare_tab(req.project_id, req.scene_number)
    try:
        downloader = Downloader()
        video_gen = VideoGenerator(page, downloader)
        reference_image_path = image_path if image_path.exists() else None

        success = await video_gen.generate(
            project_id=req.project_id,
            scene_number=req.scene_number,
            video_prompt=req.video_prompt,
            duration=req.duration,
            output_path=video_path,
            reference_image_path=reference_image_path,
            aspect_ratio=req.aspect_ratio,
        )
        return {"success": success, "video_path": str(video_path) if success else None}
    finally:
        await page.close()
        logger.info("[FLOW] Closed new tab for video-only generation", scene=req.scene_number)


@app.get("/health")
async def health():
    ext_connected = extension_manager.is_connected
    authenticated = False
    
    if ext_connected:
        authenticated = True
    else:
        try:
            authenticated = await browser_manager.verify_authenticated()
        except Exception:
            pass

    return {
        "status": "healthy",
        "browser_running": browser_manager._context is not None or ext_connected,
        "session_authenticated": authenticated,
        "extension_connected": ext_connected,
    }

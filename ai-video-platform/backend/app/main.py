"""
FastAPI application entry point.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import engine
from app.core.logging_config import configure_logging, get_logger
from app.core.storage import storage
from app.api.routes.projects import router as projects_router
from app.api.routes.scenes import router as scenes_router
from app.api.routes.websocket import router as ws_router

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    logger.info("application_starting", env=settings.app_env)

    # Ensure storage directories exist
    Path(settings.local_storage_path).mkdir(parents=True, exist_ok=True)

    yield

    logger.info("application_shutting_down")
    await engine.dispose()


app = FastAPI(
    title="AI Video Platform API",
    description="Production-grade AI Script-to-Video Automation Platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static file serving for generated assets ──────────────────────────────────
storage_path = Path(settings.local_storage_path)
storage_path.mkdir(parents=True, exist_ok=True)
app.mount("/storage", StaticFiles(directory=str(storage_path)), name="storage")

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(projects_router)
app.include_router(scenes_router)
app.include_router(ws_router)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "app": settings.app_name,
        "env": settings.app_env,
        "version": "1.0.0",
    }


@app.get("/")
async def root():
    return {"message": "AI Video Platform API", "docs": "/docs"}

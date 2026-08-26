"""
Pydantic schemas for Project API requests/responses.
"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field

from app.models.project import ProjectStatus, GenerationMode
from app.schemas.scene import SceneResponse


class ProjectCreate(BaseModel):
    prompt: str = Field(..., min_length=10, max_length=5000)
    duration: int = Field(..., ge=10, le=600)  # 10s to 10min
    language: str = Field(default="en", max_length=10)
    voice_id: Optional[str] = None
    video_style: Optional[str] = Field(default="cinematic documentary", max_length=100)
    image_style: Optional[str] = Field(default="cinematic realistic", max_length=100)
    aspect_ratio: str = Field(default="16:9", pattern=r"^\d+:\d+$")
    resolution: str = Field(default="1920x1080")
    background_music: bool = False
    subtitles_enabled: bool = True
    generation_mode: GenerationMode = GenerationMode.FULLY_AUTOMATIC


class ProjectUpdate(BaseModel):
    video_style: Optional[str] = None
    image_style: Optional[str] = None
    generation_mode: Optional[GenerationMode] = None
    subtitles_enabled: Optional[bool] = None
    background_music: Optional[bool] = None


class ProjectResponse(BaseModel):
    id: str
    user_id: str
    title: str
    prompt: str
    duration: int
    language: str
    voice_id: Optional[str]
    video_style: Optional[str]
    image_style: Optional[str]
    aspect_ratio: str
    resolution: str
    background_music: bool
    subtitles_enabled: bool
    generation_mode: str
    status: str
    progress: float
    current_stage: Optional[str]
    error_message: Optional[str]
    script_data: Optional[dict]
    visual_style_data: Optional[dict]
    thumbnail_url: Optional[str]
    final_video_url: Optional[str]
    narration_url: Optional[str]
    subtitle_url: Optional[str]
    narration_duration: Optional[float]
    created_at: datetime
    updated_at: datetime
    scenes: list[SceneResponse] = []

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    id: str
    title: str
    prompt: str
    duration: int
    status: str
    progress: float
    current_stage: Optional[str]
    thumbnail_url: Optional[str]
    final_video_url: Optional[str]
    created_at: datetime
    updated_at: datetime
    scene_count: int = 0

    model_config = {"from_attributes": True}


class DashboardStats(BaseModel):
    total_projects: int
    processing_projects: int
    completed_projects: int
    failed_projects: int
    total_videos: int

"""
Pydantic schemas for Scene API.
"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field

from app.models.scene import SceneStatus


class SceneUpdate(BaseModel):
    narration: Optional[str] = None
    image_prompt: Optional[str] = None
    video_prompt: Optional[str] = None
    visual_description: Optional[str] = None


class AssetResponse(BaseModel):
    id: str
    asset_type: str
    status: str
    public_url: Optional[str]
    file_size: Optional[int]
    duration: Optional[float]
    width: Optional[int]
    height: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class SceneResponse(BaseModel):
    id: str
    project_id: str
    scene_number: int
    start_time: str
    end_time: str
    duration: int
    narration: str
    image_prompt: str
    video_prompt: str
    visual_description: Optional[str]
    status: str
    image_status: str
    video_status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    assets: list[AssetResponse] = []

    model_config = {"from_attributes": True}

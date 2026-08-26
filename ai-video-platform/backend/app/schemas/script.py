"""
Pydantic schemas for Script/Scene JSON structure.
"""
from typing import Optional
from pydantic import BaseModel, field_validator, model_validator


class SceneSchema(BaseModel):
    scene_number: int
    start_time: str          # "00:00"
    end_time: str
    duration: int            # seconds
    narration: str
    image_prompt: str
    video_prompt: str
    visual_description: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        parts = v.split(":")
        if len(parts) != 2:
            raise ValueError(f"Time must be MM:SS, got: {v!r}")
        m, s = parts
        if not (m.isdigit() and s.isdigit()):
            raise ValueError(f"Time parts must be numeric, got: {v!r}")
        if not (0 <= int(s) < 60):
            raise ValueError(f"Seconds must be 0-59, got: {v!r}")
        return v

    @field_validator("duration")
    @classmethod
    def validate_duration_max(cls, v: int) -> int:
        if v > 6:
            raise ValueError(f"Scene duration must be maximum 6 seconds, got: {v}")
        if v < 1:
            raise ValueError(f"Scene duration must be at least 1 second, got: {v}")
        return v

    @field_validator("narration", "image_prompt", "video_prompt")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        return v.strip()


class VisualStyleSchema(BaseModel):
    visual_style: str = "cinematic realistic"
    color_style: str = "natural cinematic"
    camera_style: str = "professional film camera"
    character_consistency: str = "consistent character appearance across all scenes"
    environment_style: Optional[str] = None


class ScriptSchema(BaseModel):
    """Full validated script returned by the AI."""
    title: str
    description: str
    duration: int          # total seconds
    language: str = "en"
    visual_style: Optional[VisualStyleSchema] = None
    scenes: list[SceneSchema]

    @model_validator(mode="after")
    def validate_total_duration(self) -> "ScriptSchema":
        total = sum(s.duration for s in self.scenes)
        # Allow ±3 seconds tolerance
        if abs(total - self.duration) > 3:
            raise ValueError(
                f"Scene durations sum to {total}s but expected {self.duration}s "
                f"(diff: {total - self.duration}s, tolerance ±3s)"
            )
        return self

    @model_validator(mode="after")
    def validate_scene_numbers(self) -> "ScriptSchema":
        for i, scene in enumerate(self.scenes, start=1):
            if scene.scene_number != i:
                raise ValueError(
                    f"Scene numbers must be sequential starting at 1. "
                    f"Expected {i}, got {scene.scene_number}"
                )
        return self

    @model_validator(mode="after")
    def validate_no_empty_scenes(self) -> "ScriptSchema":
        if not self.scenes:
            raise ValueError("Script must have at least one scene")
        return self

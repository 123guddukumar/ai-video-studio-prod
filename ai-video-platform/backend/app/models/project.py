"""
Project model.
"""
import uuid
import enum

from sqlalchemy import String, Text, Integer, Float, Enum as SAEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    PROCESSING = "processing"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class GenerationMode(str, enum.Enum):
    FULLY_AUTOMATIC = "fully_automatic"
    REVIEW_SCRIPT = "review_script"
    REVIEW_ASSETS = "review_assets"
    REVIEW_BEFORE_FINAL = "review_before_final"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )

    # ── Owner (single-user dev mode — stored as constant) ──────────────────
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # ── User input ──────────────────────────────────────────────────────────
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)  # seconds
    language: Mapped[str] = mapped_column(String(10), default="en")
    voice_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    video_style: Mapped[str | None] = mapped_column(String(100), nullable=True)
    image_style: Mapped[str | None] = mapped_column(String(100), nullable=True)
    aspect_ratio: Mapped[str] = mapped_column(String(10), default="16:9")
    resolution: Mapped[str] = mapped_column(String(20), default="1920x1080")
    background_music: Mapped[bool] = mapped_column(default=False)
    subtitles_enabled: Mapped[bool] = mapped_column(default=True)

    # ── Generation settings ─────────────────────────────────────────────────
    generation_mode: Mapped[str] = mapped_column(
        SAEnum(GenerationMode), default=GenerationMode.FULLY_AUTOMATIC
    )

    # ── Status & progress ───────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(
        SAEnum(ProjectStatus), default=ProjectStatus.DRAFT, index=True
    )
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    current_stage: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Generated data ──────────────────────────────────────────────────────
    script_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    visual_style_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ── Storage paths ───────────────────────────────────────────────────────
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    final_video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    narration_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subtitle_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # ── Audio metadata ──────────────────────────────────────────────────────
    narration_duration: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Relationships ───────────────────────────────────────────────────────
    scenes: Mapped[list["Scene"]] = relationship(  # noqa: F821
        "Scene",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Scene.scene_number",
        lazy="selectin",
    )
    jobs: Mapped[list["Job"]] = relationship(  # noqa: F821
        "Job",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Project id={self.id} title={self.title!r} status={self.status}>"

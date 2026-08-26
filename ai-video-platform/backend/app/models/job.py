"""
Job model — tracks every background task in the pipeline.
"""
import uuid
import enum

from sqlalchemy import String, Text, Integer, Float, ForeignKey, Enum as SAEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class JobType(str, enum.Enum):
    SCRIPT_GENERATION = "script_generation"
    SCENE_PROMPT_GENERATION = "scene_prompt_generation"
    FLOW_IMAGE_GENERATION = "flow_image_generation"
    FLOW_VIDEO_GENERATION = "flow_video_generation"
    ELEVENLABS_GENERATION = "elevenlabs_generation"
    VIDEO_COMPOSITION = "video_composition"
    FINALIZATION = "finalization"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scene_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    job_type: Mapped[str] = mapped_column(SAEnum(JobType), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        SAEnum(JobStatus), default=JobStatus.PENDING, index=True
    )

    # ── Progress ──────────────────────────────────────────────────────────────
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, default=3)

    # ── Celery tracking ───────────────────────────────────────────────────────
    celery_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ── Error details ─────────────────────────────────────────────────────────
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ── Payload ───────────────────────────────────────────────────────────────
    input_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    project: Mapped["Project"] = relationship("Project", back_populates="jobs")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Job id={self.id} type={self.job_type} status={self.status}>"

"""
Scene model — represents one scene within a project.
"""
import uuid
import enum

from sqlalchemy import String, Text, Integer, Float, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SceneStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    FLOW_AUTOMATION_ERROR = "flow_automation_error"
    RETRYING = "retrying"


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # ── Timeline ────────────────────────────────────────────────────────────
    scene_number: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[str] = mapped_column(String(10), nullable=False)  # "00:00"
    end_time: Mapped[str] = mapped_column(String(10), nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)  # seconds

    # ── AI-generated content ─────────────────────────────────────────────────
    narration: Mapped[str] = mapped_column(Text, nullable=False)
    image_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    video_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    visual_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Status ───────────────────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(
        SAEnum(SceneStatus), default=SceneStatus.PENDING, index=True
    )
    image_status: Mapped[str] = mapped_column(
        SAEnum(SceneStatus), default=SceneStatus.PENDING
    )
    video_status: Mapped[str] = mapped_column(
        SAEnum(SceneStatus), default=SceneStatus.PENDING
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_screenshot_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    project: Mapped["Project"] = relationship("Project", back_populates="scenes")  # noqa: F821
    assets: Mapped[list["Asset"]] = relationship(  # noqa: F821
        "Asset",
        back_populates="scene",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Scene #{self.scene_number} project={self.project_id} status={self.status}>"

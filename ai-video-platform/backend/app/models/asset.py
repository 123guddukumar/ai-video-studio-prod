"""
Asset model — represents a generated file (image, video, audio, subtitle, final).
"""
import uuid
import enum

from sqlalchemy import String, Text, Integer, Float, ForeignKey, Enum as SAEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AssetType(str, enum.Enum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    SUBTITLE = "subtitle"
    FINAL_VIDEO = "final_video"
    ERROR_SCREENSHOT = "error_screenshot"


class AssetStatus(str, enum.Enum):
    PENDING = "pending"
    GENERATING = "generating"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CORRUPTED = "corrupted"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    scene_id: Mapped[str | None] = mapped_column(
        ForeignKey("scenes.id", ondelete="CASCADE"), nullable=True, index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    asset_type: Mapped[str] = mapped_column(SAEnum(AssetType), nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum(AssetStatus), default=AssetStatus.PENDING, index=True
    )

    # ── Storage ──────────────────────────────────────────────────────────────
    storage_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # ── Metadata ─────────────────────────────────────────────────────────────
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)  # bytes
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)   # seconds
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    md5_hash: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    scene: Mapped["Scene | None"] = relationship("Scene", back_populates="assets")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Asset id={self.id} type={self.asset_type} status={self.status}>"

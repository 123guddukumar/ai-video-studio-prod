"""
Local filesystem storage abstraction.
Provides the same interface that an S3 backend would, so swapping is easy.
"""
import hashlib
import shutil
from pathlib import Path

import aiofiles

from app.core.config import settings
from app.core.logging_config import get_logger

logger = get_logger(__name__)


class LocalStorageBackend:
    """
    Stores files under:
        {base_path}/projects/{project_id}/{sub_path}

    Returns publicly accessible URLs via:
        {public_url}/{relative_path}
    """

    def __init__(self) -> None:
        self.base_path = Path(settings.local_storage_path)
        self.public_url = settings.storage_public_url.rstrip("/")
        self.base_path.mkdir(parents=True, exist_ok=True)

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _resolve(self, storage_path: str) -> Path:
        return self.base_path / storage_path.lstrip("/")

    # ── Public API ─────────────────────────────────────────────────────────────

    async def upload_file(
        self, local_path: str | Path, storage_path: str
    ) -> str:
        """Copy a local file to the storage backend and return the public URL."""
        src = Path(local_path)
        dest = self._resolve(storage_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        await aiofiles.os.makedirs(str(dest.parent), exist_ok=True)
        shutil.copy2(src, dest)
        logger.info("file_uploaded", src=str(src), dest=str(dest))
        return self.get_public_url(storage_path)

    async def upload_bytes(self, data: bytes, storage_path: str, content_type: str = "application/octet-stream") -> str:
        """Write raw bytes to storage and return the public URL."""
        dest = self._resolve(storage_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(dest, "wb") as f:
            await f.write(data)
        logger.info("bytes_uploaded", dest=str(dest), size=len(data))
        return self.get_public_url(storage_path)

    async def download_file(self, storage_path: str, local_path: str | Path) -> None:
        """Copy from storage to a local path."""
        src = self._resolve(storage_path)
        dest = Path(local_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)

    def get_local_path(self, storage_path: str) -> Path:
        return self._resolve(storage_path)

    def get_public_url(self, storage_path: str) -> str:
        return f"{self.public_url}/{storage_path.lstrip('/')}"

    async def delete_file(self, storage_path: str) -> None:
        path = self._resolve(storage_path)
        if path.exists():
            path.unlink()

    async def file_exists(self, storage_path: str) -> bool:
        return self._resolve(storage_path).exists()

    async def get_file_size(self, storage_path: str) -> int:
        path = self._resolve(storage_path)
        return path.stat().st_size if path.exists() else 0

    async def compute_md5(self, storage_path: str) -> str:
        path = self._resolve(storage_path)
        md5 = hashlib.md5()
        async with aiofiles.open(path, "rb") as f:
            while chunk := await f.read(8192):
                md5.update(chunk)
        return md5.hexdigest()

    def project_base_path(self, project_id: str) -> str:
        return f"{project_id}"

    def scene_path(self, project_id: str, scene_number: int, filename: str) -> str:
        return f"{project_id}/scenes/scene_{scene_number:03d}/{filename}"

    def audio_path(self, project_id: str, filename: str = "narration.mp3") -> str:
        return f"{project_id}/audio/{filename}"

    def subtitle_path(self, project_id: str, filename: str = "subtitles.srt") -> str:
        return f"{project_id}/subtitles/{filename}"

    def final_path(self, project_id: str, filename: str = "final.mp4") -> str:
        return f"{project_id}/final/{filename}"

    def script_path(self, project_id: str) -> str:
        return f"{project_id}/script.json"


# Singleton
storage = LocalStorageBackend()

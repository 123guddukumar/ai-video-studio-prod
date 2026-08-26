"""
WebSocket connection manager — broadcasts real-time pipeline progress.
"""
import json
from typing import Any

from fastapi import WebSocket
from app.core.logging_config import get_logger

logger = get_logger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections, grouped by project_id."""

    def __init__(self) -> None:
        # project_id -> set of WebSocket connections
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, project_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        if project_id not in self._connections:
            self._connections[project_id] = set()
        self._connections[project_id].add(websocket)
        logger.info("ws_connected", project_id=project_id)

    def disconnect(self, project_id: str, websocket: WebSocket) -> None:
        if project_id in self._connections:
            self._connections[project_id].discard(websocket)
            if not self._connections[project_id]:
                del self._connections[project_id]
        logger.info("ws_disconnected", project_id=project_id)

    async def broadcast(self, project_id: str, message: dict[str, Any]) -> None:
        """Send a JSON message to all clients watching this project."""
        if project_id not in self._connections:
            return

        dead: set[WebSocket] = set()
        payload = json.dumps(message)

        for ws in list(self._connections[project_id]):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)

        for ws in dead:
            self._connections[project_id].discard(ws)

    async def broadcast_progress(
        self,
        project_id: str,
        stage: str,
        progress: float,
        status: str,
        extra: dict | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "type": "PROGRESS_UPDATE",
            "project_id": project_id,
            "stage": stage,
            "progress": progress,
            "status": status,
        }
        if extra:
            payload.update(extra)
        await self.broadcast(project_id, payload)

    async def broadcast_completed(
        self, project_id: str, final_video_url: str
    ) -> None:
        await self.broadcast(
            project_id,
            {
                "type": "GENERATION_COMPLETED",
                "project_id": project_id,
                "final_video_url": final_video_url,
            },
        )

    async def broadcast_error(
        self, project_id: str, stage: str, error: str
    ) -> None:
        await self.broadcast(
            project_id,
            {
                "type": "GENERATION_ERROR",
                "project_id": project_id,
                "stage": stage,
                "error": error,
            },
        )


# Singleton
ws_manager = ConnectionManager()

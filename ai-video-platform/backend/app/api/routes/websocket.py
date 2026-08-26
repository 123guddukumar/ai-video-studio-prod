"""
WebSocket route — real-time project pipeline updates.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.websocket_manager import ws_manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/projects/{project_id}")
async def project_websocket(project_id: str, websocket: WebSocket):
    """
    WebSocket endpoint for live pipeline progress.

    Connect from the frontend with:
        ws://localhost:8000/ws/projects/{project_id}

    Messages sent by server:
        { "type": "PROGRESS_UPDATE", "stage": "...", "progress": 72.0, ... }
        { "type": "GENERATION_COMPLETED", "final_video_url": "..." }
        { "type": "GENERATION_ERROR", "stage": "...", "error": "..." }
    """
    await ws_manager.connect(project_id, websocket)
    try:
        while True:
            # Keep the connection alive — client can send ping messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(project_id, websocket)

from fastapi import APIRouter
from pydantic import BaseModel
import sys
import os
import asyncio
from typing import Optional

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

router = APIRouter()

_download_queue: list[dict] = []
_downloading: dict[str, dict] = {}
_queue_lock = asyncio.Lock()


class DownloadRequest(BaseModel):
    item_id: str
    media_type: str
    quality: Optional[int] = None


@router.post("/add")
async def add_to_queue(req: DownloadRequest):
    async with _queue_lock:
        item = {
            "item_id": req.item_id,
            "media_type": req.media_type,
            "quality": req.quality,
            "status": "queued",
            "name": f"{req.media_type.title()} #{req.item_id[:8]}",
            "album": "Processing...",
            "downloaded": 0,
            "total": 10,
            "speed": "0",
        }
        _download_queue.append(item)
    return {"status": "queued", "position": len(_download_queue)}


@router.get("/status")
async def download_status():
    return {
        "downloading": list(_downloading.values()),
        "queue": [q for q in _download_queue if q["status"] == "queued"],
    }


@router.post("/{item_id}/pause")
async def pause_download(item_id: str):
    if item_id in _downloading:
        _downloading[item_id]["paused"] = True
    return {"status": "paused"}


@router.post("/{item_id}/cancel")
async def cancel_download(item_id: str):
    _downloading.pop(item_id, None)
    for i, q in enumerate(_download_queue):
        if q["item_id"] == item_id:
            _download_queue.pop(i)
            break
    return {"status": "cancelled"}

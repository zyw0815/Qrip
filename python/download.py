from fastapi import APIRouter
from pydantic import BaseModel
import sys
import os
import asyncio
import math
from typing import Optional

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from streamrip.client.qobuz import QobuzClient
from streamrip.media.album import PendingAlbum
from streamrip.media.track import PendingSingle
from streamrip.media.playlist import PendingPlaylist
from streamrip.db import Database, Downloads, Failed
from auth import get_config

router = APIRouter()

_download_queue: list[dict] = []
_downloading: dict[str, dict] = {}
_completed: list[dict] = []
_failed: list[dict] = []
_queue_lock = asyncio.Lock()
_download_worker_started = False
_db: Optional[Database] = None


def get_db() -> Database:
    global _db
    if _db is None:
        cfg = get_config()
        dp = cfg.session.database.downloads_path or os.path.expanduser("~/.config/streamrip/downloads.db")
        fp = cfg.session.database.failed_downloads_path or os.path.expanduser("~/.config/streamrip/failed_downloads.db")
        os.makedirs(os.path.dirname(dp), exist_ok=True)
        _db = Database(downloads=Downloads(dp), failed=Failed(fp))
    return _db


class DownloadRequest(BaseModel):
    item_id: str
    media_type: str  # track, album, playlist
    quality: Optional[int] = None


@router.post("/add")
async def add_to_queue(req: DownloadRequest):
    q = get_config().session.qobuz.quality if req.quality is None else req.quality
    async with _queue_lock:
        item = {
            "item_id": req.item_id, "media_type": req.media_type,
            "quality": q, "status": "queued",
            "name": f"{req.media_type.title()} #{req.item_id[:8]}",
            "album": "", "downloaded": 0, "total": 0, "speed": "0",
        }
        _download_queue.append(item)
    start_worker()
    return {"status": "queued", "position": len(_download_queue)}


@router.get("/status")
async def download_status():
    return {
        "downloading": list(_downloading.values()),
        "queue": [q for q in _download_queue if q["status"] == "queued"],
        "completed": list(_completed),
        "failed": list(_failed),
    }


@router.post("/{item_id}/pause")
async def pause_download(item_id: str):
    if item_id in _downloading:
        _downloading[item_id]["paused"] = True
    return {"status": "paused"}


@router.post("/{item_id}/cancel")
async def cancel_download(item_id: str):
    async with _queue_lock:
        _downloading.pop(item_id, None)
        for i, q in enumerate(_download_queue):
            if q["item_id"] == item_id:
                _download_queue.pop(i)
                break
    return {"status": "cancelled"}


@router.post("/{item_id}/retry")
async def retry_download(item_id: str):
    for f in _failed:
        if f["item_id"] == item_id:
            _failed.remove(f)
            return await add_to_queue(DownloadRequest(
                item_id=item_id, media_type=f.get("media_type", "track"),
                quality=f.get("quality"),
            ))
    return {"status": "not_found"}


def start_worker():
    global _download_worker_started
    if not _download_worker_started:
        _download_worker_started = True
        asyncio.get_event_loop().create_task(_download_worker())


async def _download_worker():
    while True:
        item = None
        async with _queue_lock:
            for q in _download_queue:
                if q["status"] == "queued":
                    q["status"] = "downloading"
                    item = q
                    break

        if item is None:
            await asyncio.sleep(0.5)
            continue

        item_id = item["item_id"]
        media_type = item["media_type"]
        quality = item["quality"]
        _downloading[item_id] = item

        try:
            cfg = get_config()
            client = QobuzClient(cfg)
            await client.login()

            if media_type == "track":
                pending = PendingSingle(item_id, client, cfg, get_db())
            elif media_type == "album":
                pending = PendingAlbum(item_id, client, cfg, get_db())
            elif media_type == "playlist":
                pending = PendingPlaylist(item_id, client, cfg, get_db())
            else:
                raise ValueError(f"Unknown media_type: {media_type}")

            # Resolve metadata
            media = await pending.resolve()
            if media is None:
                raise Exception("Failed to resolve media")

            # Set name from resolved media
            if hasattr(media, 'album'):
                item["name"] = getattr(media, 'album', media_type)
                item["album"] = getattr(media, 'albumartist', '')
            elif hasattr(media, 'title'):
                item["name"] = media.title
                if hasattr(media, 'album'):
                    item["album"] = media.album.album if media.album else ''

            # Run rip pipeline (preprocess -> download -> postprocess)
            await media.rip()

            item["status"] = "completed"
            _completed.append(item)

        except Exception as e:
            item["status"] = "failed"
            item["error"] = str(e)
            _failed.append(item)
        finally:
            _downloading.pop(item_id, None)

        await asyncio.sleep(0.1)

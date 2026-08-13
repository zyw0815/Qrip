from fastapi import APIRouter
from pydantic import BaseModel
import sys
import os
import asyncio
import time
from pathlib import Path
from typing import Optional

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from streamrip.client.qobuz import QobuzClient
from streamrip.media.album import PendingAlbum
from streamrip.media.track import PendingSingle
from streamrip.media.playlist import PendingPlaylist
from streamrip.media.artwork import remove_artwork_tempdirs
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
            # Serial downloads — one track at a time (like streamrip CLI)
            cfg.session.downloads.concurrency = False
            # Disable rich terminal progress bars (we poll files instead)
            cfg.session.cli.progress_bars = False
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

            # Set display name from resolved media metadata
            if media_type in ("album", "playlist"):
                item["name"] = media.meta.album
                item["album"] = media.meta.albumartist
            elif media_type == "track":
                item["name"] = media.meta.title
                item["album"] = media.meta.album.album if media.meta.album else ""

            # Estimate total size + poll folder for progress while ripping
            download_folder = cfg.session.downloads.folder
            total_size = await _estimate_size(client, item_id, media_type, quality)

            rip_task = asyncio.create_task(media.rip())
            _progress_poll = asyncio.create_task(
                _poll_progress(item, download_folder, total_size)
            )
            await rip_task
            _progress_poll.cancel()

            # Clean up __artwork temp dirs created during cover embedding
            remove_artwork_tempdirs()

            item["downloaded"] = item["total"] if item["total"] > 0 else total_size
            item["status"] = "completed"
            _completed.append(item)

        except Exception as e:
            item["status"] = "failed"
            item["error"] = str(e)
            _failed.append(item)
        finally:
            _downloading.pop(item_id, None)

        await asyncio.sleep(0.1)


async def _estimate_size(client: QobuzClient, item_id: str, media_type: str, quality: int) -> int:
    """Estimate total download size in MB by summing track sizes."""
    try:
        if media_type == "track":
            downloadables = [await client.get_downloadable(item_id, quality)]
        else:
            resp = await client.get_metadata(item_id, media_type)
            if media_type == "playlist":
                track_ids = [t.get("id") for t in resp.get("tracks", {}).get("items", [])]
            else:
                track_ids = [t.get("id") for t in resp.get("tracks", {}).get("items", [])]
            downloadables = []
            for tid in track_ids[:500]:
                try:
                    downloadables.append(await client.get_downloadable(str(tid), quality))
                except Exception:
                    pass

        total_bytes = 0
        for d in downloadables:
            try:
                total_bytes += await d.size()
            except Exception:
                pass
        return round(total_bytes / (1024 * 1024), 1)
    except Exception:
        return 0


async def _poll_progress(item: dict, download_folder: str, total_size: int) -> None:
    """Poll the download folder for file sizes to derive progress and speed."""
    item["total"] = total_size
    last_bytes = 0.0
    last_time = time.time()
    try:
        while True:
            await asyncio.sleep(1)
            current_bytes = 0.0
            try:
                for f in Path(download_folder).rglob("*.flac"):
                    current_bytes += f.stat().st_size
                for f in Path(download_folder).rglob("*.mp3"):
                    current_bytes += f.stat().st_size
            except Exception:
                pass
            current_mb = current_bytes / (1024 * 1024)
            now = time.time()
            delta_time = now - last_time
            speed = (current_mb - last_bytes) / delta_time if delta_time > 0 else 0
            item["downloaded"] = round(current_mb, 1)
            item["speed"] = f"{speed:.1f}"
            last_bytes = current_mb
            last_time = now
    except asyncio.CancelledError:
        pass

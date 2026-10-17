from fastapi import APIRouter
from pydantic import BaseModel
import sys
import os
import asyncio
import shutil
import time
import copy
import logging
import http.client
from typing import Optional

# streamrip is vendored inside the Qrip repo (../streamrip). Use it when
# present so source runs are self-contained; fall back to the dev machine
# path when running from a bare checkout.
# Packaged builds (PyInstaller): the vendored modules are embedded in the
# binary — insert NOTHING here, or the dev-machine fallback below could
# shadow them with an unrelated streamrip checkout (issue #70).
_HERE = os.path.dirname(os.path.abspath(__file__))
if not getattr(sys, "frozen", False):
    _QRIP_ROOT = os.path.normpath(os.path.join(_HERE, ".."))
    # sys.path entries are search roots: importing "streamrip" looks for
    # <root>/streamrip/__init__.py, so the Qrip repo root is the entry.
    if os.path.isdir(os.path.join(_QRIP_ROOT, "streamrip", "client")):
        STREAMRIP_PATH = _QRIP_ROOT
    else:
        STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
    sys.path.insert(0, STREAMRIP_PATH)

from streamrip.client.qobuz import QobuzClient
from streamrip.media.album import PendingAlbum
from streamrip.media.track import PendingSingle, Track
from streamrip.media.playlist import PendingPlaylist
from streamrip.media.artwork import remove_artwork_tempdirs
from streamrip.db import Database, Dummy
from auth import get_config, close_client
from verify import verify_audio
import proxy  # noqa: F401 — patches QobuzClient.login with system-proxy detection

logger = logging.getLogger(__name__)

# Some audio responses contain 104 headers (repeated CDN forwarding
# headers), exceeding requests/http.client's default 100 before any audio
# is read. Retain a finite limit while accepting those responses (#82).
http.client._MAXHEADERS = max(http.client._MAXHEADERS, 256)

# --- Pause/cancel plumbing -----------------------------------------------
# streamrip's fast_async_download is a blocking sync loop (requests +
# 1MB event-loop yields), so the event loop cannot interrupt it. We patch
# the module-level function so the real transfer runs in a worker thread,
# and the chunk callback becomes our control point:
#   - pause: callback sleeps inside the transfer thread -> transfer halts,
#     speed drops to 0, the event loop stays responsive
#   - cancel: callback raises -> the `with open(path, "wb")` inside
#     fast_async_download closes the file handle cleanly, no corrupt file
# _CancelledError subclasses BaseException so album/playlist internals
# (`except Exception` + gather(return_exceptions=True)) can't swallow it.
import streamrip.client.downloadable as _dl

_orig_fast_async_download = _dl.fast_async_download
_pause_events: dict[str, asyncio.Event] = {}
_cancel_events: dict[str, asyncio.Event] = {}
# The item currently being ripped — the only place a download can happen.
_active_item: dict | None = None
# item_id -> in-flight rip task, so cancel can abort it immediately.
_rip_tasks: dict[str, asyncio.Task] = {}
# Generation counter per item_id — bumped on each /add so that cleanup
# tasks from an old run never touch a re-queued task's files.
_item_gen: dict[str, int] = {}


class _CancelledError(BaseException):
    """Raised mid-transfer when the user cancels the download."""


def _patched_fast_async_download(path, url, headers, callback):
    item = _active_item
    if item is None:
        return _orig_fast_async_download(path, url, headers, callback)

    item_id = item["item_id"]
    item["current_file"] = path
    # Track every file this task writes — cancelled albums leave one small
    # chunk per track, and the sweep removes them all.
    written_files = item.setdefault("written_files", [])
    if path not in written_files:
        written_files.append(path)
    # Record the task's folder so cancel can wipe it. The artwork transfer
    # runs before album resolution finishes — its __artwork temp folder is
    # cleaned separately and must never become the task folder.
    dirname = os.path.dirname(path)
    if "__artwork" not in dirname.split(os.sep):
        item.setdefault("task_folder", dirname)
    cancel_ev = _cancel_events.get(item_id, asyncio.Event())
    pause_ev = _pause_events.get(item_id, asyncio.Event())

    def cb(size):
        # Runs in the transfer thread — blocking here blocks the transfer.
        while pause_ev.is_set() and not cancel_ev.is_set():
            time.sleep(0.1)
        if cancel_ev.is_set():
            raise _CancelledError(item_id)
        callback(size)

    # fast_async_download is a coroutine — run it on a fresh loop inside
    # the worker thread so the event loop stays responsive.
    coro = _orig_fast_async_download(path, url, headers, cb)

    async def transfer():
        try:
            await asyncio.to_thread(asyncio.run, coro)
        except Exception as exc:
            # Track.download catches transfer errors itself. Preserve the
            # cause so a failed retry doesn't become a tagger error (#82).
            item.setdefault("download_errors", {})[path] = str(exc)
            raise
        else:
            item.get("download_errors", {}).pop(path, None)

    return transfer()


_dl.fast_async_download = _patched_fast_async_download


# Track-level patch: record which path each track wrote to, so the
# post-download verification can map files back to track ids (official
# duration, re-download of broken tracks). Patching the class method
# covers every reference — album, playlist and single flows all use it.
_orig_track_download = Track.download


async def _patched_track_download(self, *args, **kwargs):
    await _orig_track_download(self, *args, **kwargs)
    item = _active_item
    if item is None:
        return
    track_id = getattr(getattr(self.meta, "info", None), "id", None)
    if track_id is not None:
        item.setdefault("track_map", {})[self.download_path] = str(track_id)
        # Record before postprocess embeds tags/artwork and changes size.
        # A full response plus valid FLAC frames can distinguish inaccurate
        # catalogue duration from an incomplete transfer (issue #81).
        expected_size = getattr(self.downloadable, "_size", 0) or 0
        try:
            received_size = os.path.getsize(self.download_path)
        except OSError:
            received_size = 0
        complete = expected_size > 0 and received_size == expected_size
        item.setdefault("transfer_complete", {})[self.download_path] = complete
        transfer_errors = item.setdefault("transfer_errors", {})
        if expected_size > 0 and received_size != expected_size:
            transfer_errors[self.download_path] = (
                f"incomplete transfer: received {received_size} of {expected_size} bytes"
            )
        elif received_size == 0:
            transfer_errors[self.download_path] = "empty download"
        else:
            transfer_errors.pop(self.download_path, None)
        if self.download_path in transfer_errors:
            cause = item.get("download_errors", {}).get(self.download_path)
            if cause:
                transfer_errors[self.download_path] += f"; download failed: {cause}"
            # The vendored downloader returns normally after both retries
            # fail. Abort before postprocess tries to tag an empty file.
            raise RuntimeError(transfer_errors[self.download_path])


Track.download = _patched_track_download


def _check_cancelled(item_id: str):
    if _cancel_events.get(item_id, asyncio.Event()).is_set():
        raise _CancelledError(item_id)


async def _sweep_cancelled(item: dict, cancel_ev: asyncio.Event, gen: int):
    """Background sweep started by the cancel endpoint.

    The rip task is aborted at cancel time, but unwinding is slow: rate-
    limited API calls still resolve, and PendingAlbum.resolve() re-creates
    the folder until it notices the abort. Sweep until the rip task is done
    AND the folder has stayed gone for a few seconds.
    """
    item_id = item["item_id"]
    folder = item.get("task_folder")
    idle_rounds = 0
    for _ in range(1200):  # ~10min hard cap — normally bounded by rip end
        if not cancel_ev.is_set():
            return  # re-queued — hands off
        if gen != _item_gen.get(item_id, 0):
            return  # this run was superseded — hands off
        for partial in list(item.get("written_files", [])):
            if partial and os.path.exists(partial):
                try:
                    os.remove(partial)
                except OSError:
                    pass
        if folder and os.path.isdir(folder) and folder != _safe_root():
            try:
                shutil.rmtree(folder)
            except OSError:
                pass  # in-flight transfer holds it — retry
        rip_task = _rip_tasks.get(item_id)
        if rip_task is None or rip_task.done():
            idle_rounds += 1
            if idle_rounds >= 6:  # ~3s of quiet after rip finished
                break
        else:
            idle_rounds = 0
        await asyncio.sleep(0.5)
    # Final pass — remove anything that reappeared in the last instant.
    for partial in list(item.get("written_files", [])):
        if partial and os.path.exists(partial):
            try:
                os.remove(partial)
            except OSError:
                pass
    if folder and os.path.isdir(folder) and folder != _safe_root():
        try:
            shutil.rmtree(folder)
        except OSError:
            pass
    remove_artwork_tempdirs()


def _cleanup_partial(item: dict):
    """Definitive cleanup once the rip task has fully stopped.

    Runs in a worker thread — bounded retries cover the orphaned transfer
    thread closing its file handle.
    """
    folder = item.get("task_folder")
    for _ in range(20):  # ~10s
        pending = False
        for partial in list(item.get("written_files", [])):
            if partial and os.path.exists(partial):
                try:
                    os.remove(partial)
                except OSError:
                    pending = True
        if folder and os.path.isdir(folder) and folder != _safe_root():
            try:
                shutil.rmtree(folder)
            except OSError:
                pending = True
        if not pending:
            break
        time.sleep(0.5)
    remove_artwork_tempdirs()


def _safe_root() -> str:
    """The download root — never rmtree it (single tracks may write here)."""
    try:
        return get_config().session.downloads.folder
    except Exception:
        return ""


router = APIRouter()

_download_queue: list[dict] = []
_downloading: dict[str, dict] = {}
_completed: list[dict] = []
_failed: list[dict] = []
_queue_lock = asyncio.Lock()
_download_worker_started = False
_db: Optional[Database] = None


def get_db() -> Database:
    """No-op database — everything is always downloadable, existing files overwrite."""
    global _db
    if _db is None:
        _db = Database(downloads=Dummy(), failed=Dummy())
    return _db


class DownloadRequest(BaseModel):
    item_id: str
    media_type: str  # track, album, playlist
    quality: Optional[int] = None


@router.post("/add")
async def add_to_queue(req: DownloadRequest):
    q = get_config().session.qobuz.quality if req.quality is None else req.quality
    # Clear stale pause/cancel state (e.g. re-queuing after a cancel) and
    # bump the generation so old cleanup tasks hand off to this new run.
    _pause_events.setdefault(req.item_id, asyncio.Event()).clear()
    _cancel_events.setdefault(req.item_id, asyncio.Event()).clear()
    _item_gen[req.item_id] = _item_gen.get(req.item_id, 0) + 1
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
    _pause_events.setdefault(item_id, asyncio.Event()).set()
    item = _downloading.get(item_id)
    if item is not None:
        item["paused"] = True
    return {"status": "paused"}


@router.post("/{item_id}/resume")
async def resume_download(item_id: str):
    _pause_events.setdefault(item_id, asyncio.Event()).clear()
    item = _downloading.get(item_id)
    if item is not None:
        item["paused"] = False
        item["speed"] = "0"
    return {"status": "resumed"}


@router.post("/{item_id}/cancel")
async def cancel_download(item_id: str):
    # Queue items: just remove. Downloading items: delete the file being
    # written right away (the transfer thread's with-block closes the handle
    # when its callback raises, so deleting here is safe), then signal cancel.
    async with _queue_lock:
        item = _downloading.pop(item_id, None)
        for i, q in enumerate(_download_queue):
            if q["item_id"] == item_id:
                _download_queue.pop(i)
                break
    _cancel_events.setdefault(item_id, asyncio.Event()).set()
    # Abort the in-flight rip task so the worker reaches its cleanup fast,
    # instead of waiting for the album/playlist internals to unwind (they
    # resolve every remaining track serially and can take minutes).
    rip_task = _rip_tasks.get(item_id)
    if rip_task is not None and not rip_task.done():
        rip_task.cancel()
    if item is not None:
        # Give the transfer thread a moment to close its file handle, then
        # sweep in the background so the cancel endpoint stays responsive.
        await asyncio.sleep(0.5)
        cancel_ev = _cancel_events.get(item_id, asyncio.Event())
        gen = _item_gen.get(item_id, 0)
        asyncio.get_running_loop().create_task(
            _sweep_cancelled(item, cancel_ev, gen)
        )
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
    global _active_item
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
        _active_item = item
        client = None
        _progress_poll = None
        try:
            # Settings can change while this task is running. Estimate,
            # transfer and retries must all use the queued quality (#80).
            cfg = copy.deepcopy(get_config())
            cfg.session.qobuz.quality = quality
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

            # Record the task's folder before any transfer — cancelling
            # during resolve/estimate leaves a (possibly empty) folder.
            # media.folder is authoritative (the artwork transfer may have
            # recorded a bogus __artwork path first).
            resolved_folder = getattr(media, "folder", None)
            if resolved_folder:
                item["task_folder"] = resolved_folder

            # Set display name from resolved media metadata
            if media_type == "album":
                item["name"] = media.meta.album
                item["album"] = media.meta.albumartist
            elif media_type == "playlist":
                item["name"] = media.meta.name
                item["album"] = ""
            elif media_type == "track":
                item["name"] = media.meta.title
                item["album"] = media.meta.album.album if media.meta.album else ""

            # Wait out a pause requested before the transfer started.
            pause_ev = _pause_events.setdefault(item_id, asyncio.Event())
            while pause_ev.is_set() and not _cancel_events.get(item_id, asyncio.Event()).is_set():
                item["paused"] = True
                await asyncio.sleep(0.2)
            _check_cancelled(item_id)

            # Estimate total size + poll this task's files for progress
            total_size = await _estimate_size(client, item_id, media_type, quality)
            _check_cancelled(item_id)

            rip_task = asyncio.create_task(media.rip())
            _rip_tasks[item_id] = rip_task
            _progress_poll = asyncio.create_task(
                _poll_progress(item, total_size)
            )
            try:
                await rip_task
            except asyncio.CancelledError:
                # The cancel endpoint aborted rip_task. The task is done —
                # fall through; _check_cancelled below triggers the cleanup.
                pass

            # Album/playlist internals swallow exceptions, so a cancelled
            # rip can complete normally — check the flag explicitly.
            _check_cancelled(item_id)

            # Clean up __artwork temp dirs created during cover embedding
            remove_artwork_tempdirs()

            # Verify every downloaded audio file (FLAC structure + duration
            # vs the official Qobuz value) and re-download broken tracks
            # individually — a single re-download lands back in the same
            # folder/name, since it uses the same metadata and templates.
            expected = await _fetch_expected_durations(client, item_id, media_type)
            failures = await asyncio.to_thread(_verify_item, item, expected)
            retries = 0
            retry_errors = {}
            while failures and retries < 2:
                retries += 1
                for path, _, _ in failures:
                    try:
                        if os.path.exists(path):
                            os.remove(path)
                    except OSError:
                        pass
                for path, track_id, _ in failures:
                    _check_cancelled(item_id)
                    try:
                        await _redownload_track(path, track_id, media, client, cfg)
                        retry_errors.pop(path, None)
                    except _CancelledError:
                        raise
                    except Exception as exc:
                        retry_errors[path] = str(exc)
                        logger.exception("Retry %d failed for %s", retries, path)
                _check_cancelled(item_id)
                failures = await asyncio.to_thread(_verify_item, item, expected)

            if failures:
                # Broken after retries: drop the bad files, keep the good
                # ones, and fail the item listing what's wrong.
                for path, _, _ in failures:
                    try:
                        if os.path.exists(path):
                            os.remove(path)
                    except OSError:
                        pass
                item["status"] = "failed"
                item["error"] = "Verification failed:\n" + "\n".join(
                    f"{os.path.basename(path)}: {reason}"
                    + (f"; retry failed: {retry_errors[path]}" if path in retry_errors else "")
                    for path, _, reason in failures
                )
                logger.error("%s: %s", item["name"], item["error"])
                _failed.append(item)
            else:
                _update_size(item)
                item["status"] = "completed"
                _completed.append(item)

        except _CancelledError:
            # Final sweep once rip has fully unwound. Runs in a thread so
            # the orphaned transfer thread's handle-closing can't block us.
            await asyncio.to_thread(_cleanup_partial, item)
            item["status"] = "cancelled"
        except Exception as e:
            item["status"] = "failed"
            item["error"] = str(e)
            _failed.append(item)
        finally:
            if _progress_poll is not None:
                _progress_poll.cancel()
                await asyncio.gather(_progress_poll, return_exceptions=True)
            _downloading.pop(item_id, None)
            _active_item = None
            _rip_tasks.pop(item_id, None)
            # The worker outlives every rip, so an unclosed session here
            # leaks for the whole process lifetime (issue #77).
            if client is not None:
                await close_client(client)
            # Keep pause/cancel events — background cleanup tasks watch them
            # to hand off when the item is re-queued.

        await asyncio.sleep(0.1)


async def _fetch_expected_durations(
    client: QobuzClient, item_id: str, media_type: str
) -> dict[str, float]:
    """Official per-track durations from Qobuz metadata ({track_id: seconds})."""
    try:
        if media_type == "track":
            resp = await client.get_metadata(item_id, "track")
            dur = resp.get("duration")
            return {str(item_id): float(dur)} if dur else {}
        resp = await client.get_metadata(item_id, media_type)
        items = resp.get("tracks", {}).get("items", [])
        return {
            str(t["id"]): float(t["duration"])
            for t in items
            if t.get("id") and t.get("duration")
        }
    except Exception:
        return {}


async def _redownload_track(path, track_id, media, client, cfg):
    """Retry using the original album/playlist metadata and output path (#81)."""
    if not track_id:
        raise ValueError("missing track ID for re-download")
    pending = next(
        (p for p in getattr(media, "tracks", []) if str(p.id) == track_id),
        None,
    )
    if pending is None:
        pending = PendingSingle(track_id, client, cfg, get_db())
    track = await pending.resolve()
    if track is None:
        raise ValueError(f"failed to resolve track {track_id}")
    # PendingSingle may otherwise retry into a different album directory;
    # playlist filenames can also depend on their original position.
    track.folder = os.path.dirname(path)
    await track.preprocess()
    track.download_path = path
    await track.download()
    await track.postprocess()


def _verify_item(item: dict, expected: dict[str, float]) -> list[tuple[str, str, str]]:
    """Verify audio files. Returns [(path, track_id, reason)] failures.

    Runs in a worker thread — file I/O and CRC math never block the loop.
    """
    failures: list[tuple[str, str, str]] = []
    track_map = item.get("track_map", {})
    paths = list(track_map.keys())
    if not paths:
        # Fallback (patch didn't fire): every audio-looking written file.
        paths = [
            p
            for p in item.get("written_files", [])
            if p.lower().endswith((".flac", ".mp3"))
        ]
    seen = set()
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        track_id = track_map.get(path, "")
        if not os.path.exists(path):
            err = "file missing"
        elif path in item.get("transfer_errors", {}):
            err = item["transfer_errors"][path]
        else:
            exp = expected.get(track_id) if track_id else None
            err = verify_audio(
                path, exp,
                transfer_complete=item.get("transfer_complete", {}).get(path, False),
            )
        if err:
            logger.warning("Verification failed for track %s (%s): %s", track_id, path, err)
            failures.append((path, track_id, err))
    return failures


class ClearCompletedRequest(BaseModel):
    delete_files: bool = False


@router.post("/completed/clear")
async def clear_completed(req: ClearCompletedRequest):
    """Clear the completed list, optionally deleting the downloaded files."""
    if req.delete_files:
        root = _safe_root()
        for item in _completed:
            folder = item.get("task_folder")
            if (
                folder
                and os.path.isdir(folder)
                and root
                and folder != root
                and folder.startswith(root + os.sep)
            ):
                try:
                    shutil.rmtree(folder)
                except OSError:
                    pass
                continue
            # Singles (folder == download root): remove only their files.
            for f in item.get("written_files", []):
                if f and os.path.exists(f):
                    try:
                        os.remove(f)
                    except OSError:
                        pass
    _completed.clear()
    return {"status": "cleared"}


async def _estimate_size(client: QobuzClient, item_id: str, media_type: str, quality: int) -> float:
    """Estimate total download size in MB by summing track sizes.

    Playlists are skipped: each get_downloadable call is rate-limited
    (60/min), so a 500-track playlist would idle for minutes before the
    first file. Their progress shows downloaded-only instead.
    """
    try:
        if media_type == "playlist":
            return 0
        if media_type == "track":
            downloadables = [await client.get_downloadable(item_id, quality)]
        else:
            resp = await client.get_metadata(item_id, media_type)
            tracks = resp.get("tracks", {})
            track_ids = [t.get("id") for t in tracks.get("items", [])]
            count = resp.get("tracks_count", tracks.get("total", len(track_ids)))
            if not track_ids or len(track_ids) != count or not all(track_ids):
                return 0
            downloadables = []
            for tid in track_ids:
                downloadables.append(await client.get_downloadable(str(tid), quality))

        total_bytes = 0
        for d in downloadables:
            size = await d.size()
            if size <= 0:
                return 0
            total_bytes += size
        return round(total_bytes / (1024 * 1024), 1)
    except Exception as exc:
        # A partial sum is not the task's total. Leave it unknown rather
        # than making progress exceed 100% when another lookup fails (#80).
        logger.info("Total size unavailable for %s: %s", item_id, exc)
        return 0


def _update_size(item: dict) -> float:
    """Current audio size in MiB, counting each output path once (#80)."""
    current_bytes = 0
    for path in set(item.get("written_files", [])):
        if not path.lower().endswith((".flac", ".mp3")):
            continue
        try:
            current_bytes += os.path.getsize(path)
        except OSError:
            pass
    current_mb = current_bytes / (1024 * 1024)
    item["downloaded"] = round(current_mb, 1)
    if item.get("total", 0) > 0 and item["downloaded"] > item["total"]:
        # Embedded artwork/tags can also make final files exceed their
        # transfer sizes. Stop presenting that estimate as a known total.
        item["total"] = 0
    return current_mb


async def _poll_progress(item: dict, total_size: float) -> None:
    """Poll this task's written files to derive progress and speed.

    Sums only files written by THIS task (recorded by the transfer patch)
    — rglob'ing the whole download folder would count every album the
    user already has, inflating the progress bar and speed.
    """
    item["total"] = total_size
    last_bytes = 0.0
    last_time = time.time()
    try:
        while True:
            await asyncio.sleep(1)
            current_mb = _update_size(item)
            now = time.time()
            delta_time = now - last_time
            speed = max(0, (current_mb - last_bytes) / delta_time) if delta_time > 0 else 0
            item["speed"] = f"{speed:.1f}"
            last_bytes = current_mb
            last_time = now
    except asyncio.CancelledError:
        pass

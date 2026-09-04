from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os

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

from streamrip.metadata.search_results import (
    SearchResults, AlbumSummary, TrackSummary, PlaylistSummary, ArtistSummary,
)
from auth import qobuz_client

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    media_type: str = "album"
    offset: int = 0


class ResolveRequest(BaseModel):
    url: str


PAGE_SIZE = 20


def item_to_dict(item: dict, media_type: str) -> dict:
    """Convert a Qobuz API item dict to a frontend-friendly result."""
    result = {
        "id": str(item.get("id", "")),
        "type": media_type,
    }
    if media_type == "album":
        title = (item.get("title") or "").strip()
        version = (item.get("version") or "").strip()
        result["title"] = title + (" (" + version + ")" if version else "")
        artist_obj = item.get("artist") or {}
        if isinstance(artist_obj, str):
            artist_name = artist_obj
        else:
            artist_name = artist_obj.get("name") or ""
        result["artist"] = artist_name or (item.get("performer", {}) or {}).get("name") or "Unknown"
        released = item.get("released_at") or item.get("release_date_original") or item.get("release_date") or ""
        if isinstance(released, (int, float)):
            import datetime
            released = datetime.datetime.fromtimestamp(released).strftime("%Y-%m-%d")
        result["year"] = str(released)[:10]
        result["tracks_count"] = item.get("tracks_count") or item.get("media_count") or 0
        result["duration"] = item.get("duration", 0)
        label_obj = item.get("label") or {}
        result["label"] = label_obj.get("name", "") if isinstance(label_obj, dict) else str(label_obj or "")
        image = item.get("image", {}) or {}
        result["cover"] = image.get("large") or image.get("small") or ""
        result["bit_depth"] = item.get("maximum_bit_depth")
        result["sampling_rate"] = item.get("maximum_sampling_rate")
    elif media_type == "track":
        result["title"] = item.get("title", "Unknown")
        result["artist"] = item.get("performer", {}).get("name") or "Unknown"
        result["duration"] = item.get("duration", 0)
        album = item.get("album", {}) or {}
        result["album_title"] = album.get("title", "")
        image = album.get("image", {}) or {}
        result["cover"] = image.get("large") or image.get("small") or ""
        result["bit_depth"] = item.get("maximum_bit_depth")
        result["sampling_rate"] = item.get("maximum_sampling_rate")
    elif media_type == "playlist":
        result["title"] = item.get("name", "Unknown")
        result["artist"] = item.get("owner", {}).get("name", "Qobuz")
        result["tracks_count"] = item.get("tracks_count", 0)
        result["duration"] = item.get("duration", 0)
        images = item.get("images", []) or []
        result["cover"] = images[0] if images else ""
        result["bit_depth"] = None
        result["sampling_rate"] = None
    return result


@router.post("/query")
async def search(req: SearchRequest):
    async with qobuz_client() as client:
        # limit=PAGE_SIZE + offset asks Qobuz for exactly this page — no need
        # to re-fetch every earlier page (and it keeps working past Qobuz's
        # 500-result cap, which broke "load more" on big searches).
        resp = await client.search(req.media_type, req.query, limit=PAGE_SIZE, offset=req.offset)

    # client.search() returns a list of PAGE dicts, each shaped like
    # {"albums": {"items": [...], "total": N, ...}}
    key = req.media_type + "s"
    items = []
    total = 0
    if isinstance(resp, list):
        for page in resp:
            if isinstance(page, dict):
                items.extend(page.get(key, {}).get("items", []))
        if resp and isinstance(resp[0], dict):
            total = resp[0].get(key, {}).get("total", 0)
    elif isinstance(resp, dict):
        items = resp.get(key, {}).get("items", [])
        total = resp.get(key, {}).get("total", 0)

    results = [item_to_dict(item, req.media_type) for item in items]
    # Relevance boost: items whose title contains the query term first
    if req.media_type == "track" and results:
        q = req.query.lower()
        results.sort(
            key=lambda r: 0 if q in r.get("title", "").lower() else 1
        )
    return {"results": results, "total": total}


@router.get("/tracks/{item_id}")
async def get_album_tracks(item_id: str):
    """Fetch the track list for an album or playlist."""
    async with qobuz_client() as client:
        try:
            resp = await client.get_metadata(item_id, "album")
        except Exception:
            try:
                resp = await client.get_metadata(item_id, "playlist")
            except Exception as e:
                raise HTTPException(500, str(e))

    tracks = []
    items = resp.get("tracks", {}).get("items", []) if isinstance(resp.get("tracks"), dict) else resp.get("tracks", [])
    for t in items:
        performer = t.get("performer", {}) or {}
        artist_name = performer.get("name") or "Unknown"
        tracks.append({
            "id": str(t.get("id", "")),
            "title": t.get("title", "Unknown"),
            "artist": artist_name,
        })
    return {"tracks": tracks}


@router.post("/resolve")
async def resolve(req: ResolveRequest):
    """Parse a Qobuz URL and return metadata."""
    async with qobuz_client() as client:
        url = req.url.strip()
        if "/track/" in url:
            media_type, item_id = "track", url.split("/track/")[1].split("?")[0]
        elif "/album/" in url:
            media_type, item_id = "album", url.split("/album/")[1].split("?")[0]
        elif "/playlist/" in url:
            media_type, item_id = "playlist", url.split("/playlist/")[1].split("?")[0]
        elif "/artist/" in url:
            media_type, item_id = "artist", url.split("/artist/")[1].split("?")[0]
        else:
            raise HTTPException(400, "Unsupported URL format")

        try:
            resp = await client.get_metadata(item_id, media_type)
            return {"type": media_type, "data": item_to_dict(resp, media_type)}
        except Exception as e:
            raise HTTPException(500, str(e))

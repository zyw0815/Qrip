from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from streamrip.client.qobuz import QobuzClient
from streamrip.metadata.search_results import (
    SearchResults, AlbumSummary, TrackSummary, PlaylistSummary, ArtistSummary,
)
from auth import get_config

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    media_type: str = "album"


class ResolveRequest(BaseModel):
    url: str


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
        result["artist"] = item.get("artist", {}).get("name") or item.get("performer", {}).get("name") or "Unknown"
        result["year"] = item.get("release_date_original") or item.get("release_date") or ""
        result["tracks_count"] = item.get("tracks_count", 0)
        result["duration"] = item.get("duration", 0)
        result["label"] = (item.get("label", {}) or {}).get("name", "")
        image = item.get("image", {}) or {}
        result["cover"] = image.get("large") or image.get("small") or ""
        result["bit_depth"] = item.get("maximum_bit_depth")
        result["sampling_rate"] = item.get("maximum_sampling_rate")
    elif media_type == "track":
        result["title"] = item.get("title", "Unknown")
        result["artist"] = item.get("performer", {}).get("name") or "Unknown"
        result["duration"] = item.get("duration", 0)
        album = item.get("album", {}) or {}
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
    cfg = get_config()
    client = QobuzClient(cfg)
    await client.login()
    resp = await client.search(req.media_type, req.query, limit=20)

    # client.search() returns a list of PAGE dicts, each shaped like
    # {"albums": {"items": [...], "total": N, ...}}
    key = req.media_type + "s"
    items = []
    if isinstance(resp, list):
        for page in resp:
            if isinstance(page, dict):
                items.extend(page.get(key, {}).get("items", []))
    elif isinstance(resp, dict):
        items = resp.get(key, {}).get("items", [])

    results = [item_to_dict(item, req.media_type) for item in items]
    return {"results": results}


@router.post("/resolve")
async def resolve(req: ResolveRequest):
    """Parse a Qobuz URL and return metadata."""
    cfg = get_config()
    client = QobuzClient(cfg)
    await client.login()

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

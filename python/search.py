from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from streamrip.client.qobuz import QobuzClient
from auth import get_config

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    media_type: str = "album"


class ResolveRequest(BaseModel):
    url: str


@router.post("/query")
async def search(req: SearchRequest):
    cfg = get_config()
    client = QobuzClient(cfg)
    await client.login()
    resp = await client.search(req.media_type, req.query, limit=20)
    return {"results": resp.get("items", resp) if isinstance(resp, dict) else []}


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
    else:
        raise HTTPException(400, "Unsupported URL format")

    try:
        resp = await client.get_metadata(item_id, media_type)
        return {"type": media_type, "data": resp}
    except Exception as e:
        raise HTTPException(500, str(e))

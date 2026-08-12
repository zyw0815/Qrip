from fastapi import APIRouter
from pydantic import BaseModel
import sys
import os

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from auth import get_config

router = APIRouter()


@router.get("/")
async def get_config_all():
    cfg = get_config()
    return {
        "download_folder": cfg.session.downloads.folder,
        "quality": cfg.session.qobuz.quality,
        "folder_format": cfg.session.filepaths.folder_format,
        "track_format": cfg.session.filepaths.track_format,
        "embed_cover": cfg.session.artwork.embed,
        "embed_size": cfg.session.artwork.embed_size,
        "save_artwork": cfg.session.artwork.save_artwork,
        "saved_max_width": cfg.session.artwork.saved_max_width,
    }


class UpdateConfigRequest(BaseModel):
    key: str
    value: str | int | bool


@router.post("/update")
async def update_config(req: UpdateConfigRequest):
    cfg = get_config()
    path_map = {
        "download_folder": ("downloads", "folder"),
        "quality": ("qobuz", "quality"),
        "folder_format": ("filepaths", "folder_format"),
        "track_format": ("filepaths", "track_format"),
        "embed_cover": ("artwork", "embed"),
        "embed_size": ("artwork", "embed_size"),
        "save_artwork": ("artwork", "save_artwork"),
        "saved_max_width": ("artwork", "saved_max_width"),
    }
    if req.key in path_map:
        section, field = path_map[req.key]
        section_obj = getattr(cfg.session, section)
        setattr(section_obj, field, req.value)
        cfg.file._modified = True
    return {"status": "ok"}

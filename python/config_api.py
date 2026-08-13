from fastapi import APIRouter
from pydantic import BaseModel
import sys
import os

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from auth import get_config

router = APIRouter()


# UI-friendly token → streamrip native key
# Folder templates: streamrip uses {albumartist} and {title} (= album name)
# File templates:   streamrip uses {artist}, {title}, {tracknumber}
def ui_to_native(template: str, kind: str) -> str:
    if kind == "folder":
        return template.replace("{artist}", "{albumartist}").replace("{album}", "{title}")
    return template.replace("{track}", "{tracknumber}")


def native_to_ui(template: str, kind: str) -> str:
    if kind == "folder":
        return template.replace("{albumartist}", "{artist}").replace("{title}", "{album}")
    return template.replace("{tracknumber}", "{track}")


@router.get("/")
async def get_config_all():
    cfg = get_config()
    return {
        "download_folder": cfg.session.downloads.folder,
        "quality": cfg.session.qobuz.quality,
        "folder_format": native_to_ui(cfg.session.filepaths.folder_format, "folder"),
        "track_format": native_to_ui(cfg.session.filepaths.track_format, "file"),
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
    value = req.value
    if req.key == "folder_format" and isinstance(value, str):
        value = ui_to_native(value, "folder")
    elif req.key == "track_format" and isinstance(value, str):
        value = ui_to_native(value, "file")
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
        setattr(section_obj, field, value)
        cfg.file._modified = True
    return {"status": "ok"}

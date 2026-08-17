from fastapi import APIRouter
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

from auth import get_config, _save_settings

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


# Quality: UI uses index 0-3, streamrip native values are 1-4
# (1=MP3 320, 2=16/44.1, 3=24/96, 4=24/192).
def quality_to_ui(q: int) -> int:
    return max(0, min(3, q - 1))


def quality_to_native(idx: int) -> int:
    return max(1, min(4, idx + 1))


# embed_size: UI label <-> streamrip native value
EMBED_SIZE_TO_NATIVE = {
    "Thumbnail (≈250×250)": "thumbnail",
    "Small (≈600×600)": "small",
    "Large (≈1400×1400)": "large",
    "Original": "original",
}
EMBED_SIZE_TO_UI = {v: k for k, v in EMBED_SIZE_TO_NATIVE.items()}

# saved_max_width: UI label <-> native int (-1 = no resize)
SAVED_WIDTH_TO_NATIVE = {
    "250": 250,
    "600": 600,
    "1400": 1400,
    "Original (no resize)": -1,
}
SAVED_WIDTH_TO_UI = {v: k for k, v in SAVED_WIDTH_TO_NATIVE.items()}


@router.get("/")
async def get_config_all():
    cfg = get_config()
    return {
        "download_folder": cfg.session.downloads.folder,
        "quality": quality_to_ui(cfg.session.qobuz.quality),
        "folder_format": native_to_ui(cfg.session.filepaths.folder_format, "folder"),
        "track_format": native_to_ui(cfg.session.filepaths.track_format, "file"),
        "embed_cover": cfg.session.artwork.embed,
        "embed_size": EMBED_SIZE_TO_UI.get(
            cfg.session.artwork.embed_size, cfg.session.artwork.embed_size
        ),
        "save_artwork": cfg.session.artwork.save_artwork,
        "saved_max_width": SAVED_WIDTH_TO_UI.get(
            cfg.session.artwork.saved_max_width, str(cfg.session.artwork.saved_max_width)
        ),
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
    elif req.key == "quality" and isinstance(value, int):
        value = quality_to_native(value)
    elif req.key == "embed_size" and isinstance(value, str):
        value = EMBED_SIZE_TO_NATIVE.get(value, value)
    elif req.key == "saved_max_width" and isinstance(value, str):
        value = SAVED_WIDTH_TO_NATIVE.get(value, -1)
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
        # Persist immediately — streamrip's own config file is never saved.
        _save_settings(cfg)
    return {"status": "ok"}

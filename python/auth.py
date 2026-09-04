from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import sys
import os
import json

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

from streamrip.config import Config
import click

router = APIRouter()
_config: Config | None = None
_logged_in = False

# Dev mode: skip login for browser development. Set QRIP_DEV=0 to require real auth.
_DEV_MODE = os.environ.get("QRIP_DEV", "0") == "1"

# Persist credentials in Qrip's own config file so they survive restarts
_QRIP_CONFIG_PATH = os.path.join(click.get_app_dir("Qrip"), "credentials.toml")
# Settings also live in Qrip's app dir — streamrip's own config machinery is
# never saved, so Qrip keeps its own file.
_QRIP_SETTINGS_PATH = os.path.join(click.get_app_dir("Qrip"), "settings.toml")

# Settings key -> (streamrip config section, field). Values are stored in
# streamrip's native format (quality 1-4, embed_size "large" etc.).
SETTINGS_FIELDS = {
    "download_folder": ("downloads", "folder"),
    "quality": ("qobuz", "quality"),
    "folder_format": ("filepaths", "folder_format"),
    "track_format": ("filepaths", "track_format"),
    "embed_cover": ("artwork", "embed"),
    "embed_size": ("artwork", "embed_size"),
    "save_artwork": ("artwork", "save_artwork"),
    "saved_max_width": ("artwork", "saved_max_width"),
}


def _toml_scalar(value) -> str:
    """Render a Python value as a TOML scalar (strings via JSON escaping)."""
    if isinstance(value, str):
        return json.dumps(value)
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def _save_settings(cfg: Config):
    """Write the current settings to Qrip's settings.toml."""
    os.makedirs(os.path.dirname(_QRIP_SETTINGS_PATH), exist_ok=True)
    lines = ["[settings]"]
    for key, (section, field) in SETTINGS_FIELDS.items():
        v = getattr(getattr(cfg.session, section), field)
        lines.append(f"{key} = {_toml_scalar(v)}")
    with open(_QRIP_SETTINGS_PATH, "w") as f:
        f.write("\n".join(lines) + "\n")


def _load_settings(cfg: Config):
    """Overlay settings.toml onto the config. Missing file -> no-op."""
    if not os.path.exists(_QRIP_SETTINGS_PATH):
        return
    import tomllib
    with open(_QRIP_SETTINGS_PATH, "rb") as f:
        data = tomllib.load(f)
    settings = data.get("settings", {})
    for key, (section, field) in SETTINGS_FIELDS.items():
        if key in settings:
            setattr(getattr(cfg.session, section), field, settings[key])


class TokenLoginRequest(BaseModel):
    token: str


class GoogleLoginRequest(BaseModel):
    user_id: str
    token: str


def _save_credentials(cfg: Config):
    """Write login credentials to Qrip's config file."""
    os.makedirs(os.path.dirname(_QRIP_CONFIG_PATH), exist_ok=True)
    c = cfg.session.qobuz
    with open(_QRIP_CONFIG_PATH, "w") as f:
        f.write("[qobuz]\n")
        f.write(f'email_or_userid = "{c.email_or_userid}"\n')
        f.write(f'password_or_token = "{c.password_or_token}"\n')
        f.write(f'use_auth_token = {"true" if c.use_auth_token else "false"}\n')
        f.write(f'app_id = "{c.app_id}"\n')
        if c.secrets:
            f.write(f'secrets = {c.secrets}\n')


def _load_saved_credentials(cfg: Config) -> bool:
    """Load credentials from Qrip's config file. Returns True if found."""
    if not os.path.exists(_QRIP_CONFIG_PATH):
        return False
    import tomllib
    with open(_QRIP_CONFIG_PATH, "rb") as f:
        data = tomllib.load(f)
    q = data.get("qobuz", {})
    c = cfg.session.qobuz
    c.email_or_userid = q.get("email_or_userid", "")
    c.password_or_token = q.get("password_or_token", "")
    c.use_auth_token = q.get("use_auth_token", False)
    c.app_id = q.get("app_id", "")
    c.secrets = q.get("secrets", [])
    return bool(c.email_or_userid and c.password_or_token)


def get_config() -> Config:
    global _config, _logged_in
    if _config is None:
        _config = Config.defaults()
        # Qrip's own defaults (overriding streamrip's blank template values)
        # Note: stored with streamrip's native format keys
        #   folder: {albumartist} = artist, {title} = album name
        #   file:   {artist}, {title}, {tracknumber}
        s = _config.session
        s.filepaths.folder_format = "{albumartist} — {title} ({year})"
        s.filepaths.track_format = "{artist} — {title}"
        s.artwork.save_artwork = False
        if not s.downloads.folder:
            s.downloads.folder = os.path.expanduser("~/Music/Qrip")
        try:
            if _load_saved_credentials(_config):
                _logged_in = True
        except Exception:
            # A corrupt/partial credentials file must not break /auth/status
            # (a 500 makes the frontend treat the backend as unavailable and
            # give up) — treat it as "not logged in" instead.
            _logged_in = False
        try:
            _load_settings(_config)
        except Exception:
            # Same policy as credentials: a corrupt settings file just
            # means defaults for this run.
            pass
    return _config


async def close_client(client) -> None:
    """Close a QobuzClient's aiohttp session.

    streamrip opens the session in login() and never closes it, so every
    request leaked a session plus its pooled connections — the backend log
    filled up with "Unclosed client session" (issue #77).
    """
    session = getattr(client, "session", None)
    if session is not None and not session.closed:
        await session.close()


@asynccontextmanager
async def qobuz_client():
    """A logged-in QobuzClient whose session is closed on every exit path."""
    from streamrip.client.qobuz import QobuzClient

    client = QobuzClient(get_config())
    await client.login()
    try:
        yield client
    finally:
        await close_client(client)


@router.get("/status")
async def auth_status():
    # Trigger credential loading from disk if not yet initialized
    get_config()
    if _DEV_MODE:
        return {"authenticated": True}
    return {"authenticated": _logged_in}


@router.post("/login/token")
async def login_token(req: TokenLoginRequest):
    global _logged_in
    cfg = get_config()
    cfg.session.qobuz.password_or_token = req.token
    cfg.session.qobuz.use_auth_token = True

    from streamrip.client.qobuz import QobuzClient

    client = QobuzClient(cfg)
    try:
        await client.login()
    except Exception as e:
        raise HTTPException(401, str(e))
    _save_credentials(cfg)
    _logged_in = True
    return {"status": "ok"}


@router.post("/login/google")
async def login_google(req: GoogleLoginRequest):
    """Called by Electron after OAuth flow captures token + user_id from localStorage."""
    global _logged_in
    cfg = get_config()
    cfg.session.qobuz.email_or_userid = req.user_id
    cfg.session.qobuz.password_or_token = req.token
    cfg.session.qobuz.use_auth_token = True

    from streamrip.client.qobuz import QobuzClient

    client = QobuzClient(cfg)
    try:
        await client.login()
    except Exception as e:
        raise HTTPException(401, str(e))
    _save_credentials(cfg)
    _logged_in = True
    return {"status": "ok"}


@router.post("/logout")
async def logout():
    global _logged_in, _config
    _logged_in = False
    # Drop the in-memory config as well. app_id/secrets live on it, and
    # QobuzClient.login only re-fetches them when *both* are empty — keeping
    # the singleton made a re-login reuse stale values and skip the spoofer,
    # so logging out and back in could not recover from bad ones (issue #77).
    _config = None
    # Clear saved credentials
    try:
        os.remove(_QRIP_CONFIG_PATH)
    except FileNotFoundError:
        pass
    return {"status": "logged_out"}

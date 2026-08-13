from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os

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


class EmailLoginRequest(BaseModel):
    email: str
    password: str


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
        s = _config.session
        s.filepaths.folder_format = "{artist} — {album} ({year})"
        s.filepaths.track_format = "{artist} — {title}"
        s.artwork.save_artwork = False
        if not s.downloads.folder:
            s.downloads.folder = os.path.expanduser("~/Music/Qrip")
        if _load_saved_credentials(_config):
            _logged_in = True
    return _config


@router.get("/status")
async def auth_status():
    # Trigger credential loading from disk if not yet initialized
    get_config()
    if _DEV_MODE:
        return {"authenticated": True}
    return {"authenticated": _logged_in}


@router.post("/login/email")
async def login_email(req: EmailLoginRequest):
    global _logged_in
    cfg = get_config()
    cfg.session.qobuz.email_or_userid = req.email
    cfg.session.qobuz.password_or_token = req.password
    cfg.session.qobuz.use_auth_token = False

    from streamrip.client.qobuz import QobuzClient

    client = QobuzClient(cfg)
    try:
        await client.login()
    except Exception as e:
        raise HTTPException(401, str(e))
    _save_credentials(cfg)
    _logged_in = True
    return {"status": "ok"}


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
    global _logged_in
    _logged_in = False
    # Clear saved credentials
    try:
        os.remove(_QRIP_CONFIG_PATH)
    except FileNotFoundError:
        pass
    return {"status": "logged_out"}

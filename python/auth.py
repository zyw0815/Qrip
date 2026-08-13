from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
import os

STREAMRIP_PATH = os.path.expanduser("~/Study/MyProject/streamrip")
sys.path.insert(0, STREAMRIP_PATH)

from streamrip.config import Config

router = APIRouter()
_config: Config | None = None
_logged_in = False

# Dev mode: skip login for browser development. Set QRIP_DEV=0 to require real auth.
_DEV_MODE = os.environ.get("QRIP_DEV", "0") == "1"


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class TokenLoginRequest(BaseModel):
    token: str


class GoogleLoginRequest(BaseModel):
    user_id: str
    token: str


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config.defaults()
    return _config


@router.get("/status")
async def auth_status():
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
    _logged_in = True
    return {"status": "ok"}


@router.post("/logout")
async def logout():
    global _logged_in
    _logged_in = False
    return {"status": "logged_out"}

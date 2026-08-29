"""System-proxy support: direct-first, proxy fallback.

Windows system-proxy VPNs (Clash etc. in "system proxy" mode) only cover
apps that read the OS proxy settings — aiohttp doesn't by default. This
module probes, once per process: can we reach Qobuz directly? If not, is
there a working system proxy? The winning proxy URL is handed to
streamrip's session factories (PROXY_URL in the vendored client module).

Probe runs on the first QobuzClient.login() (patched below), before any
session is created, so the result is always ready.
"""

import logging
import os
import urllib.request

import aiohttp

import streamrip.client.client as _sr_client
from streamrip.client.qobuz import QobuzClient

logger = logging.getLogger(__name__)

_PROBE_URL = os.environ.get("QRIP_PROBE_URL", "https://play.qobuz.com/login")
_PROBE_TIMEOUT = 6  # seconds
_detected = False
_proxy: str | None = None


def _system_proxies() -> list[str]:
    """Proxy URLs from the OS settings (Windows registry / macOS / env)."""
    proxies: list[str] = []
    try:
        raw = urllib.request.getproxies()
    except Exception:
        raw = {}
    for scheme in ("https", "http"):
        url = raw.get(scheme)
        if url and url not in proxies:
            proxies.append(url)
    return proxies


async def _can_reach(proxy: str | None) -> bool:
    try:
        timeout = aiohttp.ClientTimeout(total=_PROBE_TIMEOUT)
        kwargs = {"proxy": proxy} if proxy else {}
        async with aiohttp.ClientSession(timeout=timeout, **kwargs) as session:
            async with session.get(_PROBE_URL, allow_redirects=False) as resp:
                return resp.status < 500
    except Exception:
        return False


async def ensure_proxy_detected() -> str | None:
    """Probe once per process; returns the proxy URL to use (None = direct)."""
    global _detected, _proxy
    if _detected:
        return _proxy
    _detected = True

    if await _can_reach(None):
        return None

    for url in _system_proxies():
        if await _can_reach(url):
            _proxy = url
            # Keep both session factories in sync: get_session reads
            # client.PROXY_URL; qobuz.py's spoofer imported a snapshot.
            _sr_client.PROXY_URL = url
            import streamrip.client.qobuz as _qobuz

            _qobuz.PROXY_URL = url
            logger.info(
                "Qobuz not reachable directly — using system proxy %s", url
            )
            return url

    logger.warning("Qobuz unreachable directly and no working system proxy")
    return None


# Patch: probe before the first login so the session factories already
# know whether to use a proxy.
_orig_login = QobuzClient.login


async def _patched_login(self):
    await ensure_proxy_detected()
    return await _orig_login(self)


QobuzClient.login = _patched_login

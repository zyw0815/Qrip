from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import copy
import logging
import uvicorn

# The Electron main process pipes our stdout/stderr into backend.log, so a
# plain stream handler is all the backend needs. Without one, streamrip's
# and proxy.py's loggers have no handler at all and Python falls back to
# logging.lastResort (WARNING), silently dropping every INFO line — most
# importantly "using system proxy %s", the only record of whether the proxy
# fallback actually engaged. Diagnosing issue #76 was blind without it.
# uvicorn's own dictConfig leaves the root logger alone, so this survives.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)

from auth import router as auth_router
from search import router as search_router
from download import router as download_router
from config_api import router as config_router

app = FastAPI(title="Qrip Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")
app.include_router(search_router, prefix="/search")
app.include_router(download_router, prefix="/download")
app.include_router(config_router, prefix="/config")


class _SkipPollingFilter(logging.Filter):
    """Drop access-log lines for the endpoints the UI polls continuously.

    The login page hits /auth/status every 2s and the downloads tab hits
    /download/status every second. In a reported 2640-line log they were
    1724 lines (65%), and since the log is wiped whole once it passes 1MB
    (electron/main.ts), that noise is what evicts the actual stack traces.
    """

    _NOISY = ("/auth/status", "/download/status")

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not any(path in message for path in self._NOISY)


if __name__ == "__main__":
    # Attach the filter through uvicorn's own config: it applies dictConfig
    # at startup, which would replace a filter added to the logger here.
    log_config = copy.deepcopy(uvicorn.config.LOGGING_CONFIG)
    log_config["filters"] = {"skip_polling": {"()": _SkipPollingFilter}}
    log_config["handlers"]["access"]["filters"] = ["skip_polling"]
    uvicorn.run(
        app, host="127.0.0.1", port=8000, log_level="info", log_config=log_config
    )

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

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


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

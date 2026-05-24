"""LazyMind Algorithm Service — parse, embed, RAG chat."""
import logging
import signal
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import settings
from .db.connection import init_db
from .vectorstore.milvus_lite import MilvusLiteStore
from .parse.router import router as parse_router
from .embed.router import router as embed_router
from .chat.router import router as chat_router

logger = logging.getLogger("algorithm")

vector_store: MilvusLiteStore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    global vector_store

    # Initialize database
    if settings.algo_db_path:
        init_db(settings.algo_db_path)
        logger.info(f"algo.db initialized at {settings.algo_db_path}")

    # Initialize vector store
    if settings.vector_dir:
        vector_store = MilvusLiteStore(settings.vector_dir)
        logger.info(f"Milvus Lite initialized at {settings.vector_dir}")

    logger.info(f"Algorithm service starting on {settings.host}:{settings.port}")

    yield

    # Shutdown
    if vector_store:
        vector_store.close()
        logger.info("Vector store closed")


app = FastAPI(
    title="LazyMind Algorithm Service",
    version="0.2.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def verify_secret(request: Request, call_next):
    """Verify X-Desktop-Secret header for all non-health endpoints."""
    if request.url.path in ("/health", "/docs", "/openapi.json"):
        return await call_next(request)

    secret = request.headers.get("x-desktop-secret", "")
    if settings.local_secret and secret != settings.local_secret:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    return await call_next(request)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "algorithm"}


@app.get("/api/chat/health")
async def chat_health():
    """Health check for chat path (matches proxy route)."""
    return {"status": "ok", "service": "algorithm"}


app.include_router(parse_router)
app.include_router(embed_router)
app.include_router(chat_router)


def get_vector_store() -> MilvusLiteStore | None:
    return vector_store


def main():
    logging.basicConfig(
        level=logging.DEBUG if settings.debug else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        stream=sys.stdout,
    )

    def handle_signal(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    uvicorn.run(
        "backend.algorithm.main:app",
        host=settings.host,
        port=settings.port,
        log_level="debug" if settings.debug else "info",
    )


if __name__ == "__main__":
    main()

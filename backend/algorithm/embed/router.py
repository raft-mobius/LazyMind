"""Embedding API routes."""
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from ..config import settings
from .service import get_pending_chunks, get_api_key
from .batch import embed_document_chunks, embed_pending_for_user

logger = logging.getLogger("algorithm.embed")

router = APIRouter(prefix="/api/chat/embed", tags=["embed"])


class EmbedDocRequest(BaseModel):
    user_id: str
    doc_id: str
    api_key: str | None = None
    provider: str = "dashscope"
    config_id: str = ""
    model: str = ""


class EmbedPendingRequest(BaseModel):
    user_id: str
    api_key: str | None = None
    provider: str = "dashscope"
    config_id: str = ""
    model: str = ""


class EmbedResponse(BaseModel):
    status: str
    embedded: int = 0
    total: int = 0
    errors: list[str] = []


@router.post("/document", response_model=EmbedResponse)
async def embed_document(req: EmbedDocRequest):
    """Embed all chunks of a document."""
    api_key = req.api_key
    if not api_key and req.config_id:
        api_key = await get_api_key(req.provider, req.config_id)
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided or found in credential store")

    result = await embed_document_chunks(req.user_id, req.doc_id, api_key, req.model)
    return EmbedResponse(**result)


@router.post("/pending", response_model=EmbedResponse)
async def embed_pending(req: EmbedPendingRequest):
    """Embed all pending chunks for a user."""
    api_key = req.api_key
    if not api_key and req.config_id:
        api_key = await get_api_key(req.provider, req.config_id)
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided or found in credential store")

    result = await embed_pending_for_user(req.user_id, api_key, req.model)
    return EmbedResponse(**result)


@router.get("/status/{user_id}")
async def embedding_status(user_id: str):
    """Get embedding status for a user (how many pending)."""
    pending = get_pending_chunks(user_id, limit=1000)
    return {"user_id": user_id, "pending_count": len(pending)}

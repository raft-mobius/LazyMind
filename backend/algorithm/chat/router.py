"""Chat API routes with RAG."""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings
from ..embed.service import get_api_key
from .rag import chat_with_rag, retrieve_context, build_context_prompt
from .stream import create_sse_response

logger = logging.getLogger("algorithm.chat")

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    user_id: str
    query: str
    conversation_id: str = ""
    history_id: str = ""
    api_key: str | None = None
    provider: str = "dashscope"
    config_id: str = ""
    chat_model: str = ""
    embedding_model: str = ""
    conversation_history: list[dict] | None = None
    top_k: int = 5
    stream: bool = True


class RetrieveRequest(BaseModel):
    user_id: str
    query: str
    api_key: str | None = None
    provider: str = "dashscope"
    config_id: str = ""
    embedding_model: str = ""
    top_k: int = 10


@router.post("/completions")
async def chat_completions(req: ChatRequest):
    """RAG chat completions endpoint (SSE streaming by default)."""
    api_key = req.api_key
    if not api_key and req.config_id:
        api_key = await get_api_key(req.provider, req.config_id)
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided or found in credential store")

    result = await chat_with_rag(
        user_id=req.user_id,
        query=req.query,
        api_key=api_key,
        chat_model=req.chat_model,
        embedding_model=req.embedding_model,
        conversation_history=req.conversation_history,
        top_k=req.top_k,
        stream=req.stream,
    )

    if req.stream:
        return create_sse_response(result)
    else:
        return result


@router.post("/retrieve")
async def retrieve(req: RetrieveRequest):
    """Retrieve relevant context without calling LLM."""
    api_key = req.api_key
    if not api_key and req.config_id:
        api_key = await get_api_key(req.provider, req.config_id)
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided or found in credential store")

    results = await retrieve_context(
        user_id=req.user_id,
        query=req.query,
        api_key=api_key,
        top_k=req.top_k,
        embedding_model=req.embedding_model,
    )

    return {
        "results": [
            {"chunk_id": r.chunk_id, "doc_id": r.doc_id, "text": r.text, "score": r.score, "sources": r.sources}
            for r in results
        ]
    }

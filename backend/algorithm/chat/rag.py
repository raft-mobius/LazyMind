"""RAG orchestration: query → embed → search → context → LLM."""
import logging
from typing import Any, AsyncGenerator

from ..config import settings
from ..main import get_vector_store
from ..embed.service import embed_texts, get_api_key
from .fusion import reciprocal_rank_fusion, FusedResult

logger = logging.getLogger("algorithm.chat")

SYSTEM_PROMPT_TEMPLATE = """你是一个智能助手。请根据以下参考资料回答用户的问题。如果参考资料中没有相关信息，请基于你的知识回答，并说明这不是来自文档的信息。

参考资料：
{context}
"""


async def retrieve_context(
    user_id: str,
    query: str,
    api_key: str,
    top_k: int = 10,
    embedding_model: str = "",
) -> list[FusedResult]:
    """Retrieve relevant context for a query using vector search (+ future FTS)."""
    embedding_model = embedding_model or settings.default_embedding_model
    vector_store = get_vector_store()

    if not vector_store:
        logger.warning("Vector store not available, returning empty context")
        return []

    # Embed the query
    query_vectors = await embed_texts([query], api_key, embedding_model)
    if not query_vectors:
        return []

    query_vector = query_vectors[0]

    # Vector search
    vector_results = await vector_store.search(user_id, query_vector, top_k=top_k)
    vector_dicts = [
        {"chunk_id": r.chunk_id, "doc_id": r.doc_id, "text": r.text, "score": r.score}
        for r in vector_results
    ]

    # FTS search (placeholder — integrate with core SegmentStore later)
    fts_dicts: list[dict] = []

    # Fuse results
    if fts_dicts:
        fused = reciprocal_rank_fusion(vector_dicts, fts_dicts, top_n=top_k)
    else:
        fused = [
            FusedResult(chunk_id=r["chunk_id"], doc_id=r["doc_id"], text=r["text"], score=r["score"], sources=["vector"])
            for r in vector_dicts[:top_k]
        ]

    return fused


def build_context_prompt(results: list[FusedResult]) -> str:
    """Build context string from retrieval results."""
    if not results:
        return ""

    parts = []
    for i, r in enumerate(results, 1):
        parts.append(f"[{i}] {r.text}")
    return "\n\n".join(parts)


async def chat_with_rag(
    user_id: str,
    query: str,
    api_key: str,
    chat_model: str = "",
    embedding_model: str = "",
    conversation_history: list[dict] | None = None,
    top_k: int = 5,
    stream: bool = True,
) -> AsyncGenerator[dict[str, Any], None] | dict[str, Any]:
    """Full RAG pipeline: retrieve context → build prompt → call LLM."""
    chat_model = chat_model or settings.default_chat_model
    embedding_model = embedding_model or settings.default_embedding_model

    # Retrieve
    context_results = await retrieve_context(user_id, query, api_key, top_k, embedding_model)
    context_text = build_context_prompt(context_results)

    # Build messages
    messages: list[dict] = []
    if context_text:
        messages.append({"role": "system", "content": SYSTEM_PROMPT_TEMPLATE.format(context=context_text)})
    else:
        messages.append({"role": "system", "content": "你是一个智能助手。请回答用户的问题。"})

    if conversation_history:
        messages.extend(conversation_history)

    messages.append({"role": "user", "content": query})

    # Sources metadata
    sources = [
        {"doc_id": r.doc_id, "chunk_id": r.chunk_id, "text": r.text[:200], "score": r.score, "sources": r.sources}
        for r in context_results
    ]

    if stream:
        return _stream_chat(messages, api_key, chat_model, sources)
    else:
        return await _complete_chat(messages, api_key, chat_model, sources)


async def _stream_chat(
    messages: list[dict],
    api_key: str,
    model: str,
    sources: list[dict],
) -> AsyncGenerator[dict[str, Any], None]:
    """Stream chat response from LLM."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    # Determine base_url based on model
    if "qwen" in model or "dashscope" in model:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
    )

    seq = 0
    full_response = ""
    reasoning_content = ""

    async for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if not delta:
            continue

        content = delta.content or ""
        reasoning = getattr(delta, "reasoning_content", "") or ""

        if reasoning:
            reasoning_content += reasoning

        if content:
            full_response += content
            seq += 1
            yield {
                "seq": seq,
                "delta": content,
                "message": full_response,
                "reasoning_content": reasoning_content,
                "finish_reason": "",
                "sources": sources if seq == 1 else [],
            }

    # Final message
    yield {
        "seq": seq + 1,
        "delta": "",
        "message": full_response,
        "reasoning_content": reasoning_content,
        "finish_reason": "stop",
        "sources": sources,
    }


async def _complete_chat(
    messages: list[dict],
    api_key: str,
    model: str,
    sources: list[dict],
) -> dict[str, Any]:
    """Non-streaming chat completion."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    if "qwen" in model or "dashscope" in model:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )

    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=False,
    )

    content = response.choices[0].message.content or ""
    return {
        "message": content,
        "sources": sources,
        "finish_reason": "stop",
    }

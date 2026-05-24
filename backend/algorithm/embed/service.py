"""Embedding service: embed document chunks and store vectors."""
import uuid
import logging
from typing import Any

import httpx

from ..config import settings
from ..db.connection import get_connection

logger = logging.getLogger("algorithm.embed")


async def get_api_key(provider: str, config_id: str) -> str | None:
    """Retrieve API key from credential bridge."""
    url = f"{settings.credential_bridge_url}/internal/credentials/model/{provider}_{config_id}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers={"x-desktop-secret": settings.local_secret})
        if resp.status_code == 200:
            return resp.json().get("value")
    return None


async def embed_texts(texts: list[str], api_key: str, model: str = "") -> list[list[float]]:
    """Call embedding API to get vectors for texts."""
    model = model or settings.default_embedding_model

    if "dashscope" in model or "text-embedding" in model:
        return await _embed_dashscope(texts, api_key, model)
    else:
        return await _embed_openai_compatible(texts, api_key, model)


async def _embed_dashscope(texts: list[str], api_key: str, model: str) -> list[list[float]]:
    """Call DashScope embedding API."""
    import dashscope
    from dashscope import TextEmbedding

    dashscope.api_key = api_key

    results: list[list[float]] = []
    # DashScope batch limit is 25 texts
    batch_size = 25
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        resp = TextEmbedding.call(model=model, input=batch)
        if resp.status_code == 200:
            for emb in resp.output["embeddings"]:
                results.append(emb["embedding"])
        else:
            raise RuntimeError(f"DashScope embedding failed: {resp.code} {resp.message}")
    return results


async def _embed_openai_compatible(texts: list[str], api_key: str, model: str) -> list[list[float]]:
    """Call OpenAI-compatible embedding API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)
    resp = await client.embeddings.create(model=model, input=texts)
    return [d.embedding for d in resp.data]


def create_embedding_tasks(user_id: str, chunk_ids: list[str], model_name: str = "") -> list[str]:
    """Create embedding task records for chunks."""
    model_name = model_name or settings.default_embedding_model
    task_ids = []

    with get_connection() as conn:
        for chunk_id in chunk_ids:
            task_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO embedding_tasks (id, user_id, chunk_id, status, model_name, vector_dim)
                   VALUES (?, ?, ?, 'pending', ?, ?)""",
                (task_id, user_id, chunk_id, model_name, settings.embedding_dim),
            )
            task_ids.append(task_id)
        conn.commit()

    return task_ids


def get_pending_chunks(user_id: str, limit: int = 100) -> list[dict]:
    """Get chunks that haven't been embedded yet."""
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT dc.id, dc.user_id, dc.doc_id, dc.chunk_index, dc.content
               FROM document_chunks dc
               LEFT JOIN embedding_tasks et ON et.chunk_id = dc.id AND et.status = 'completed'
               WHERE dc.user_id = ? AND et.id IS NULL
               ORDER BY dc.created_at
               LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def mark_tasks_completed(task_ids: list[str]) -> None:
    """Mark embedding tasks as completed."""
    with get_connection() as conn:
        for tid in task_ids:
            conn.execute(
                "UPDATE embedding_tasks SET status='completed', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
                (tid,),
            )
        conn.commit()


def mark_tasks_failed(task_ids: list[str], error: str) -> None:
    """Mark embedding tasks as failed."""
    with get_connection() as conn:
        for tid in task_ids:
            conn.execute(
                "UPDATE embedding_tasks SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?",
                (error, tid),
            )
        conn.commit()

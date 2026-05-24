"""Batch embedding processor."""
import uuid
import logging
from typing import Any

from ..config import settings
from ..db.connection import get_connection
from ..main import get_vector_store
from .service import embed_texts, create_embedding_tasks, mark_tasks_completed, mark_tasks_failed, get_pending_chunks

logger = logging.getLogger("algorithm.embed")


async def embed_document_chunks(
    user_id: str,
    doc_id: str,
    api_key: str,
    model: str = "",
    batch_size: int = 20,
) -> dict[str, Any]:
    """Embed all chunks for a document and store in vector store."""
    model = model or settings.default_embedding_model
    vector_store = get_vector_store()
    if not vector_store:
        raise RuntimeError("Vector store not initialized")

    await vector_store.ensure_collection(user_id, settings.embedding_dim)

    # Get chunks for this document
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT id, doc_id, chunk_index, content
               FROM document_chunks WHERE user_id=? AND doc_id=?
               ORDER BY chunk_index""",
            (user_id, doc_id),
        ).fetchall()

    if not rows:
        return {"status": "no_chunks", "embedded": 0}

    chunks = [dict(r) for r in rows]
    total_embedded = 0
    errors: list[str] = []

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        texts = [c["content"] for c in batch]
        chunk_ids = [c["id"] for c in batch]

        task_ids = create_embedding_tasks(user_id, chunk_ids, model)

        try:
            vectors = await embed_texts(texts, api_key, model)

            ids = [str(uuid.uuid4()) for _ in batch]
            doc_ids = [c["doc_id"] for c in batch]

            await vector_store.insert(
                user_id=user_id,
                vectors=vectors,
                ids=ids,
                doc_ids=doc_ids,
                chunk_ids=chunk_ids,
                texts=texts,
            )

            mark_tasks_completed(task_ids)
            total_embedded += len(batch)

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Embedding batch failed: {error_msg}")
            mark_tasks_failed(task_ids, error_msg)
            errors.append(error_msg)

    return {
        "status": "completed" if not errors else "partial",
        "embedded": total_embedded,
        "total": len(chunks),
        "errors": errors,
    }


async def embed_pending_for_user(user_id: str, api_key: str, model: str = "", batch_size: int = 20) -> dict[str, Any]:
    """Embed all pending chunks for a user."""
    model = model or settings.default_embedding_model
    vector_store = get_vector_store()
    if not vector_store:
        raise RuntimeError("Vector store not initialized")

    await vector_store.ensure_collection(user_id, settings.embedding_dim)

    pending = get_pending_chunks(user_id, limit=500)
    if not pending:
        return {"status": "no_pending", "embedded": 0}

    total_embedded = 0
    errors: list[str] = []

    for i in range(0, len(pending), batch_size):
        batch = pending[i:i + batch_size]
        texts = [c["content"] for c in batch]
        chunk_ids = [c["id"] for c in batch]

        task_ids = create_embedding_tasks(user_id, chunk_ids, model)

        try:
            vectors = await embed_texts(texts, api_key, model)

            ids = [str(uuid.uuid4()) for _ in batch]
            doc_ids = [c["doc_id"] for c in batch]

            await vector_store.insert(
                user_id=user_id,
                vectors=vectors,
                ids=ids,
                doc_ids=doc_ids,
                chunk_ids=chunk_ids,
                texts=texts,
            )

            mark_tasks_completed(task_ids)
            total_embedded += len(batch)

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Embedding batch failed for user {user_id}: {error_msg}")
            mark_tasks_failed(task_ids, error_msg)
            errors.append(error_msg)

    return {
        "status": "completed" if not errors else "partial",
        "embedded": total_embedded,
        "total": len(pending),
        "errors": errors,
    }

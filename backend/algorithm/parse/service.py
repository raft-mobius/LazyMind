"""Parse service: handles document reading and chunking."""
import os
import uuid
import logging
import mimetypes
from pathlib import Path
from datetime import datetime, timezone

from ..db.connection import get_connection
from .chunker import chunk_text

logger = logging.getLogger("algorithm.parse")

SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".rst", ".py", ".go", ".js", ".ts", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".html", ".xml", ".csv"}


def create_parse_task(user_id: str, source_path: str) -> dict:
    """Create a new parse task for a file."""
    task_id = str(uuid.uuid4())
    file_name = os.path.basename(source_path)
    file_size = os.path.getsize(source_path) if os.path.exists(source_path) else 0
    mime_type, _ = mimetypes.guess_type(source_path)

    with get_connection() as conn:
        conn.execute(
            """INSERT INTO parse_tasks (id, user_id, source_path, file_name, file_size, mime_type, status)
               VALUES (?, ?, ?, ?, ?, ?, 'pending')""",
            (task_id, user_id, source_path, file_name, file_size, mime_type or "text/plain"),
        )
        conn.commit()

    return {"task_id": task_id, "status": "pending"}


def execute_parse_task(task_id: str) -> dict:
    """Execute a parse task: read file, chunk it, store chunks."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM parse_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise ValueError(f"Parse task not found: {task_id}")

        task = dict(row)
        user_id = task["user_id"]
        source_path = task["source_path"]

        # Update status to processing
        conn.execute(
            "UPDATE parse_tasks SET status='processing', updated_at=datetime('now') WHERE id=?",
            (task_id,),
        )
        conn.commit()

    try:
        ext = Path(source_path).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")

        text = Path(source_path).read_text(encoding="utf-8", errors="replace")
        chunks = chunk_text(text)

        doc_id = str(uuid.uuid4())

        with get_connection() as conn:
            for chunk in chunks:
                chunk_id = str(uuid.uuid4())
                conn.execute(
                    """INSERT INTO document_chunks (id, parse_task_id, user_id, doc_id, chunk_index, content, token_count)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (chunk_id, task_id, user_id, doc_id, chunk.index, chunk.content, chunk.token_count),
                )

            conn.execute(
                """UPDATE parse_tasks
                   SET status='completed', chunk_count=?, completed_at=datetime('now'), updated_at=datetime('now')
                   WHERE id=?""",
                (len(chunks), task_id),
            )
            conn.commit()

        logger.info(f"Parsed {source_path}: {len(chunks)} chunks")
        return {"task_id": task_id, "status": "completed", "doc_id": doc_id, "chunk_count": len(chunks)}

    except Exception as e:
        logger.error(f"Parse failed for {task_id}: {e}")
        with get_connection() as conn:
            conn.execute(
                "UPDATE parse_tasks SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?",
                (str(e), task_id),
            )
            conn.commit()
        return {"task_id": task_id, "status": "failed", "error": str(e)}


def get_parse_task_status(task_id: str) -> dict | None:
    """Get the status of a parse task."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM parse_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
        return dict(row)


def list_parse_tasks(user_id: str, status: str | None = None) -> list[dict]:
    """List parse tasks for a user."""
    with get_connection() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM parse_tasks WHERE user_id=? AND status=? ORDER BY created_at DESC",
                (user_id, status),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM parse_tasks WHERE user_id=? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
        return [dict(r) for r in rows]


def get_chunks_by_task(task_id: str) -> list[dict]:
    """Get all chunks for a parse task."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM document_chunks WHERE parse_task_id=? ORDER BY chunk_index",
            (task_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_chunks_by_doc(user_id: str, doc_id: str) -> list[dict]:
    """Get all chunks for a document."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM document_chunks WHERE user_id=? AND doc_id=? ORDER BY chunk_index",
            (user_id, doc_id),
        ).fetchall()
        return [dict(r) for r in rows]

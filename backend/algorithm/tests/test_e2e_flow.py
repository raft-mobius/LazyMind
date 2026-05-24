"""E2E test: Full user journey — create assistant → add document → parse → ask question."""
import os
import tempfile
import shutil
import pytest

from backend.algorithm.db.connection import init_db, get_connection
from backend.algorithm.parse.service import create_parse_task, execute_parse_task


@pytest.fixture
def e2e_env():
    """Full E2E environment with database and sample documents."""
    d = tempfile.mkdtemp()
    db_path = os.path.join(d, "algo.db")
    init_db(db_path)

    # Create a sample knowledge document
    doc_path = os.path.join(d, "knowledge.md")
    with open(doc_path, "w", encoding="utf-8") as f:
        f.write("""# Company Knowledge Base

## Product Overview

LazyMind is an AI-powered knowledge management system. It helps teams organize,
search, and leverage their collective knowledge using advanced RAG (Retrieval
Augmented Generation) technology.

## Architecture

The system uses a microservice architecture with the following components:
- Core service: handles user management and data storage
- Algorithm service: handles parsing, embedding, and RAG chat
- Scan control plane: manages document discovery and ingestion
- File watcher: monitors file system changes

## Desktop Mode

Desktop Mode runs all services locally on the user's machine. It uses SQLite
instead of PostgreSQL, Milvus Lite instead of distributed Milvus, and in-process
services instead of network-deployed containers.

## Key Features

1. Multi-assistant support: up to 50 isolated AI assistants per user
2. Local document scanning: monitor folders for new/changed files
3. Vector search: semantic similarity search using embeddings
4. Full-text search: BM25 ranking for keyword matching
5. Hybrid retrieval: combines vector and FTS via reciprocal rank fusion
""")

    yield {"dir": d, "doc_path": doc_path, "db_path": db_path}
    shutil.rmtree(d, ignore_errors=True)


def test_e2e_document_ingestion(e2e_env):
    """E2E: Document ingestion pipeline works end-to-end."""
    user_id = "astronomer"  # default assistant
    doc_path = e2e_env["doc_path"]

    # Step 1: Create and execute parse task
    task = create_parse_task(user_id, doc_path)
    assert task["task_id"]

    result = execute_parse_task(task["task_id"])
    assert result["status"] == "completed"
    assert result["chunk_count"] >= 3  # Should have multiple chunks

    # Step 2: Verify chunks are stored correctly
    doc_id = result["doc_id"]
    with get_connection() as conn:
        chunks = conn.execute(
            "SELECT * FROM document_chunks WHERE user_id=? AND doc_id=? ORDER BY chunk_index",
            (user_id, doc_id),
        ).fetchall()

    assert len(chunks) >= 3

    # Step 3: Verify content integrity
    all_content = " ".join(dict(c)["content"] for c in chunks)
    assert "LazyMind" in all_content
    assert "RAG" in all_content
    assert "microservice" in all_content


def test_e2e_multi_assistant_document_isolation(e2e_env):
    """E2E: Multiple assistants can parse documents with full isolation."""
    doc_path = e2e_env["doc_path"]

    assistants = ["astronomer", "researcher", "engineer"]
    results = {}

    for user_id in assistants:
        task = create_parse_task(user_id, doc_path)
        result = execute_parse_task(task["task_id"])
        assert result["status"] == "completed"
        results[user_id] = result

    # Verify each assistant has their own chunks
    with get_connection() as conn:
        for user_id in assistants:
            count = conn.execute(
                "SELECT COUNT(*) FROM document_chunks WHERE user_id=?", (user_id,)
            ).fetchone()[0]
            assert count > 0

            # Verify no cross-user data
            others = [u for u in assistants if u != user_id]
            for other in others:
                cross = conn.execute(
                    "SELECT COUNT(*) FROM document_chunks WHERE user_id=? AND parse_task_id IN (SELECT id FROM parse_tasks WHERE user_id=?)",
                    (user_id, other),
                ).fetchone()[0]
                assert cross == 0

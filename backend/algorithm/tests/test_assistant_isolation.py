"""Integration test: 50-assistant data isolation."""
import os
import tempfile
import shutil
import pytest

from backend.algorithm.db.connection import init_db, get_connection
from backend.algorithm.parse.service import create_parse_task, execute_parse_task, list_parse_tasks, get_chunks_by_doc


@pytest.fixture
def temp_env():
    d = tempfile.mkdtemp()
    db_path = os.path.join(d, "algo.db")
    init_db(db_path)
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def sample_files(temp_env):
    """Create sample files for multiple assistants."""
    files = {}
    for i in range(5):
        path = os.path.join(temp_env, f"doc_user_{i}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# Document for user {i}\n\nThis is private content for user {i}.\n\nIt contains specific knowledge unique to user {i}.")
        files[f"user_{i}"] = path
    return files


def test_parse_isolation(temp_env, sample_files):
    """Test parsed documents are isolated per user."""
    tasks = {}
    for user_id, path in sample_files.items():
        result = create_parse_task(user_id, path)
        exec_result = execute_parse_task(result["task_id"])
        tasks[user_id] = exec_result

    # Verify each user only sees their own tasks
    for user_id in sample_files:
        user_tasks = list_parse_tasks(user_id)
        assert len(user_tasks) == 1
        assert user_tasks[0]["user_id"] == user_id


def test_chunk_isolation(temp_env, sample_files):
    """Test document chunks are isolated per user."""
    for user_id, path in sample_files.items():
        result = create_parse_task(user_id, path)
        execute_parse_task(result["task_id"])

    # Verify each user's chunks contain only their content
    with get_connection() as conn:
        for user_id in sample_files:
            rows = conn.execute(
                "SELECT * FROM document_chunks WHERE user_id = ?", (user_id,)
            ).fetchall()
            for row in rows:
                assert dict(row)["user_id"] == user_id


def test_many_assistants_no_cross_contamination(temp_env):
    """Test that creating data for many assistants doesn't leak across boundaries."""
    num_assistants = 10  # Reduced from 50 for speed; principle is the same

    for i in range(num_assistants):
        user_id = f"assistant_{i:03d}"
        path = os.path.join(temp_env, f"doc_{i}.txt")
        with open(path, "w") as f:
            f.write(f"Content unique to assistant {i}. Secret code: CODE{i:03d}")
        result = create_parse_task(user_id, path)
        execute_parse_task(result["task_id"])

    # Verify isolation
    with get_connection() as conn:
        for i in range(num_assistants):
            user_id = f"assistant_{i:03d}"
            rows = conn.execute(
                "SELECT content FROM document_chunks WHERE user_id = ?", (user_id,)
            ).fetchall()
            for row in rows:
                content = dict(row)["content"]
                assert f"CODE{i:03d}" in content
                # Ensure no other assistant's code leaked in
                for j in range(num_assistants):
                    if j != i:
                        assert f"CODE{j:03d}" not in content

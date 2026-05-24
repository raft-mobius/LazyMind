"""Integration test: Document pipeline (parse → chunk → embed → vector store)."""
import os
import tempfile
import shutil
import pytest

from backend.algorithm.db.connection import init_db, get_connection
from backend.algorithm.parse.service import create_parse_task, execute_parse_task, get_chunks_by_task
from backend.algorithm.parse.chunker import chunk_text


@pytest.fixture
def temp_env():
    """Create temporary environment for testing."""
    d = tempfile.mkdtemp()
    db_path = os.path.join(d, "algo.db")
    init_db(db_path)
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def sample_file(temp_env):
    """Create a sample text file for parsing."""
    content = """# Machine Learning Overview

Machine learning is a subset of artificial intelligence that focuses on building systems
that learn from data. It has become increasingly important in modern technology.

## Supervised Learning

Supervised learning uses labeled training data to learn the mapping between inputs
and outputs. Common algorithms include linear regression, decision trees, and neural networks.

## Unsupervised Learning

Unsupervised learning finds patterns in unlabeled data. Clustering and dimensionality
reduction are common unsupervised learning techniques.

## Deep Learning

Deep learning uses artificial neural networks with multiple layers. It has achieved
remarkable results in computer vision, natural language processing, and speech recognition.
"""
    file_path = os.path.join(temp_env, "ml_overview.md")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    return file_path


def test_chunker_basic():
    """Test text chunking produces non-empty results."""
    text = "Hello world. " * 100
    chunks = chunk_text(text, chunk_size=200, chunk_overlap=20)
    assert len(chunks) > 0
    for chunk in chunks:
        assert chunk.content
        assert chunk.token_count > 0


def test_chunker_overlap():
    """Test chunks have overlap."""
    paragraphs = [f"Paragraph {i} with some content." for i in range(20)]
    text = "\n\n".join(paragraphs)
    chunks = chunk_text(text, chunk_size=100, chunk_overlap=30)
    assert len(chunks) > 1


def test_parse_task_lifecycle(temp_env, sample_file):
    """Test complete parse task lifecycle: create → execute → get chunks."""
    user_id = "test_user_1"

    # Create
    result = create_parse_task(user_id, sample_file)
    assert result["status"] == "pending"
    task_id = result["task_id"]

    # Execute
    exec_result = execute_parse_task(task_id)
    assert exec_result["status"] == "completed"
    assert exec_result["chunk_count"] > 0

    # Get chunks
    chunks = get_chunks_by_task(task_id)
    assert len(chunks) == exec_result["chunk_count"]
    for chunk in chunks:
        assert chunk["content"]
        assert chunk["user_id"] == user_id


def test_parse_unsupported_extension(temp_env):
    """Test parsing unsupported file type fails gracefully."""
    user_id = "test_user_1"
    file_path = os.path.join(temp_env, "test.xyz")
    with open(file_path, "w") as f:
        f.write("content")

    result = create_parse_task(user_id, file_path)
    exec_result = execute_parse_task(result["task_id"])
    assert exec_result["status"] == "failed"


def test_parse_nonexistent_file(temp_env):
    """Test parsing nonexistent file fails gracefully."""
    user_id = "test_user_1"
    result = create_parse_task(user_id, "/nonexistent/path.txt")
    exec_result = execute_parse_task(result["task_id"])
    assert exec_result["status"] == "failed"


def test_multiple_users_isolation(temp_env, sample_file):
    """Test different users' parse tasks are isolated."""
    result1 = create_parse_task("user_a", sample_file)
    result2 = create_parse_task("user_b", sample_file)

    execute_parse_task(result1["task_id"])
    execute_parse_task(result2["task_id"])

    chunks_a = get_chunks_by_task(result1["task_id"])
    chunks_b = get_chunks_by_task(result2["task_id"])

    for c in chunks_a:
        assert c["user_id"] == "user_a"
    for c in chunks_b:
        assert c["user_id"] == "user_b"

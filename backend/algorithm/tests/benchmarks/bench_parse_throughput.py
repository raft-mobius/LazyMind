"""Benchmark: Parse throughput — 100KB document should complete in <30s."""
import os
import time
import tempfile
import shutil
import pytest

from backend.algorithm.db.connection import init_db
from backend.algorithm.parse.service import create_parse_task, execute_parse_task
from backend.algorithm.parse.chunker import chunk_text


@pytest.fixture
def bench_env():
    d = tempfile.mkdtemp()
    db_path = os.path.join(d, "algo.db")
    init_db(db_path)
    yield d
    shutil.rmtree(d, ignore_errors=True)


def generate_100kb_file(directory: str) -> str:
    """Generate a ~100KB text file with realistic content."""
    path = os.path.join(directory, "large_doc.md")
    content_lines = []
    for i in range(200):
        content_lines.append(f"## Section {i}")
        content_lines.append("")
        content_lines.append(f"This is paragraph {i} of the document. It contains various topics ")
        content_lines.append(f"about machine learning, data science, and software engineering. ")
        content_lines.append(f"The content here discusses concept number {i} in detail with examples.")
        content_lines.append("")
    content = "\n".join(content_lines)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def test_parse_100kb_under_30s(bench_env):
    """100KB document should parse and chunk in under 30 seconds."""
    file_path = generate_100kb_file(bench_env)
    file_size = os.path.getsize(file_path)
    assert file_size >= 90_000, f"File too small: {file_size} bytes"

    start = time.time()
    result = create_parse_task("bench_user", file_path)
    exec_result = execute_parse_task(result["task_id"])
    elapsed = time.time() - start

    assert exec_result["status"] == "completed"
    assert exec_result["chunk_count"] > 0
    assert elapsed < 30.0, f"Parse took {elapsed:.2f}s, expected <30s"
    print(f"BENCHMARK: parse 100KB → {exec_result['chunk_count']} chunks in {elapsed:.2f}s")


def test_chunker_throughput(bench_env):
    """Chunking 1MB of text should complete quickly."""
    text = "Lorem ipsum dolor sit amet. " * 40000  # ~1MB

    start = time.time()
    chunks = chunk_text(text, chunk_size=512, chunk_overlap=64)
    elapsed = time.time() - start

    assert len(chunks) > 100
    assert elapsed < 5.0, f"Chunking 1MB took {elapsed:.2f}s, expected <5s"
    print(f"BENCHMARK: chunk 1MB → {len(chunks)} chunks in {elapsed:.2f}s")

"""Benchmark: Memory usage — baseline should be < 500MB."""
import os
import sys
import pytest


def test_memory_baseline_note():
    """Memory benchmark note.

    Measure with: Start all services, wait for healthy, then measure total RSS.

    Tools:
    - Windows: tasklist /FI "IMAGENAME eq python.exe" /FO CSV
    - Windows: tasklist /FI "IMAGENAME eq core.exe" /FO CSV
    - Or use Resource Monitor

    Expected total: < 500MB for all services at idle

    Breakdown targets:
    - core.exe: < 80MB
    - auth-service (Python): < 60MB
    - algorithm-service (Python + Milvus): < 200MB
    - scan-control-plane: < 40MB
    - file-watcher: < 30MB
    - Electron main process: < 90MB
    """
    pass


def test_import_memory():
    """Test that importing algorithm modules doesn't use excessive memory."""
    import tracemalloc
    tracemalloc.start()

    from backend.algorithm.parse.chunker import chunk_text
    from backend.algorithm.chat.fusion import reciprocal_rank_fusion

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # Importing core modules should use less than 50MB
    assert peak < 50 * 1024 * 1024, f"Import peak memory: {peak / 1024 / 1024:.1f}MB"

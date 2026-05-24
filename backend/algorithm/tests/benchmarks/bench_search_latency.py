"""Benchmark: Search latency — P95 < 1s at 10K documents (FTS5)."""
import os
import time
import tempfile
import shutil
import uuid
import pytest


@pytest.fixture
def segment_store():
    """Create and populate a SegmentStore with test data."""
    # This benchmark requires the Go segment store
    # For now, test the Python-accessible FTS path
    pytest.skip("Segment store benchmark requires Go binary — run via 'go test -bench'")


def test_fts_search_latency_note():
    """Placeholder: FTS5 search latency benchmark.

    Run with Go: cd backend/core/segment && go test -bench=BenchmarkSearch -benchtime=10s
    Expected: P95 < 1s at 10K segments
    """
    pass

"""Integration test: Chat RAG pipeline (retrieve context → fusion → response)."""
import pytest
from backend.algorithm.chat.fusion import reciprocal_rank_fusion, FusedResult


def test_rrf_vector_only():
    """Test RRF with only vector results."""
    vector_results = [
        {"chunk_id": "c1", "doc_id": "d1", "text": "first", "score": 0.95},
        {"chunk_id": "c2", "doc_id": "d1", "text": "second", "score": 0.85},
        {"chunk_id": "c3", "doc_id": "d2", "text": "third", "score": 0.70},
    ]
    fts_results = []

    fused = reciprocal_rank_fusion(vector_results, fts_results, top_n=3)
    assert len(fused) == 3
    assert fused[0].chunk_id == "c1"
    assert fused[0].score > fused[1].score > fused[2].score
    assert "vector" in fused[0].sources


def test_rrf_both_sources():
    """Test RRF combining vector and FTS results."""
    vector_results = [
        {"chunk_id": "c1", "doc_id": "d1", "text": "vector hit", "score": 0.9},
        {"chunk_id": "c2", "doc_id": "d1", "text": "vector only", "score": 0.8},
    ]
    fts_results = [
        {"chunk_id": "c1", "doc_id": "d1", "text": "fts hit", "score": 5.0},
        {"chunk_id": "c3", "doc_id": "d2", "text": "fts only", "score": 4.0},
    ]

    fused = reciprocal_rank_fusion(vector_results, fts_results, top_n=5)

    # c1 should be ranked first (found by both retrievers)
    assert fused[0].chunk_id == "c1"
    assert "vector" in fused[0].sources
    assert "fts" in fused[0].sources


def test_rrf_deduplication():
    """Test RRF deduplicates by chunk_id."""
    vector_results = [
        {"chunk_id": "c1", "doc_id": "d1", "text": "same chunk", "score": 0.9},
    ]
    fts_results = [
        {"chunk_id": "c1", "doc_id": "d1", "text": "same chunk", "score": 5.0},
    ]

    fused = reciprocal_rank_fusion(vector_results, fts_results, top_n=10)
    assert len(fused) == 1
    assert fused[0].chunk_id == "c1"


def test_rrf_empty_inputs():
    """Test RRF with empty inputs."""
    fused = reciprocal_rank_fusion([], [], top_n=10)
    assert len(fused) == 0


def test_rrf_top_n_limit():
    """Test RRF respects top_n limit."""
    vector_results = [
        {"chunk_id": f"c{i}", "doc_id": "d1", "text": f"text {i}", "score": 0.9 - i * 0.1}
        for i in range(20)
    ]
    fused = reciprocal_rank_fusion(vector_results, [], top_n=5)
    assert len(fused) == 5

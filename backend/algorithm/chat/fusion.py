"""Reciprocal Rank Fusion for combining vector and FTS search results."""
from dataclasses import dataclass


@dataclass
class FusedResult:
    chunk_id: str
    doc_id: str
    text: str
    score: float
    sources: list[str]  # which retrievers found this ("vector", "fts")


def reciprocal_rank_fusion(
    vector_results: list[dict],
    fts_results: list[dict],
    k: int = 60,
    top_n: int = 10,
) -> list[FusedResult]:
    """Combine vector and FTS results using Reciprocal Rank Fusion.

    RRF score = sum(1 / (k + rank_i)) for each retriever that found the result.
    """
    scores: dict[str, float] = {}
    metadata: dict[str, dict] = {}
    result_sources: dict[str, list[str]] = {}

    # Score vector results
    for rank, item in enumerate(vector_results):
        chunk_id = item["chunk_id"]
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
        metadata[chunk_id] = item
        result_sources.setdefault(chunk_id, []).append("vector")

    # Score FTS results
    for rank, item in enumerate(fts_results):
        chunk_id = item["chunk_id"]
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
        if chunk_id not in metadata:
            metadata[chunk_id] = item
        result_sources.setdefault(chunk_id, []).append("fts")

    # Sort by fused score
    sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)[:top_n]

    return [
        FusedResult(
            chunk_id=cid,
            doc_id=metadata[cid].get("doc_id", ""),
            text=metadata[cid].get("text", ""),
            score=scores[cid],
            sources=result_sources[cid],
        )
        for cid in sorted_ids
    ]

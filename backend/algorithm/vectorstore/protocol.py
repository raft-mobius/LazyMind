"""VectorStore protocol for Desktop mode vector storage."""
from typing import Protocol, Any


class VectorSearchResult:
    """A single vector search result."""

    def __init__(self, id: str, doc_id: str, chunk_id: str, text: str, score: float):
        self.id = id
        self.doc_id = doc_id
        self.chunk_id = chunk_id
        self.text = text
        self.score = score

    def __repr__(self) -> str:
        return f"VectorSearchResult(id={self.id!r}, score={self.score:.4f})"


class VectorStore(Protocol):
    """Protocol for vector storage backends."""

    async def ensure_collection(self, user_id: str, dim: int) -> None:
        """Ensure a collection exists for the given user with the specified vector dimension."""
        ...

    async def insert(
        self,
        user_id: str,
        vectors: list[list[float]],
        ids: list[str],
        doc_ids: list[str],
        chunk_ids: list[str],
        texts: list[str],
    ) -> None:
        """Insert vectors with metadata into the user's collection."""
        ...

    async def search(
        self,
        user_id: str,
        query_vector: list[float],
        top_k: int = 10,
        doc_id_filter: str | None = None,
    ) -> list[VectorSearchResult]:
        """Search for similar vectors in the user's collection."""
        ...

    async def delete_by_doc(self, user_id: str, doc_id: str) -> int:
        """Delete all vectors for a given document. Returns count deleted."""
        ...

    async def delete_collection(self, user_id: str) -> None:
        """Delete entire collection for a user."""
        ...

    async def collection_stats(self, user_id: str) -> dict[str, Any]:
        """Get statistics about a user's collection (vector_count, etc.)."""
        ...

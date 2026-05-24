"""Milvus Lite implementation of VectorStore for Desktop mode."""
import os
import asyncio
from typing import Any
from functools import partial

from pymilvus import MilvusClient, DataType

from .protocol import VectorSearchResult


def _collection_name(user_id: str) -> str:
    safe_id = user_id.replace("-", "_")
    return f"lazymind_vectors_{safe_id}"


class MilvusLiteStore:
    """VectorStore implementation using Milvus Lite (local file-based)."""

    def __init__(self, data_dir: str):
        self._db_path = os.path.join(data_dir, "milvus_lite.db")
        os.makedirs(data_dir, exist_ok=True)
        self._client = MilvusClient(uri=self._db_path)
        self._initialized_collections: set[str] = set()

    async def ensure_collection(self, user_id: str, dim: int) -> None:
        col_name = _collection_name(user_id)
        if col_name in self._initialized_collections:
            return

        loop = asyncio.get_event_loop()
        exists = await loop.run_in_executor(
            None, self._client.has_collection, col_name
        )

        if not exists:
            from pymilvus import CollectionSchema, FieldSchema

            schema = CollectionSchema(fields=[
                FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=128),
                FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=dim),
                FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=128),
                FieldSchema(name="chunk_id", dtype=DataType.VARCHAR, max_length=128),
                FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
            ])

            await loop.run_in_executor(
                None, partial(self._client.create_collection, collection_name=col_name, schema=schema)
            )

            index_params = self._client.prepare_index_params()
            index_params.add_index(
                field_name="vector",
                index_type="FLAT",
                metric_type="COSINE",
            )
            await loop.run_in_executor(
                None, partial(self._client.create_index, collection_name=col_name, index_params=index_params)
            )

        self._initialized_collections.add(col_name)

    async def insert(
        self,
        user_id: str,
        vectors: list[list[float]],
        ids: list[str],
        doc_ids: list[str],
        chunk_ids: list[str],
        texts: list[str],
    ) -> None:
        col_name = _collection_name(user_id)
        data = [
            {"id": id_, "vector": vec, "doc_id": did, "chunk_id": cid, "text": txt}
            for id_, vec, did, cid, txt in zip(ids, vectors, doc_ids, chunk_ids, texts)
        ]

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, partial(self._client.insert, collection_name=col_name, data=data)
        )

    async def search(
        self,
        user_id: str,
        query_vector: list[float],
        top_k: int = 10,
        doc_id_filter: str | None = None,
    ) -> list[VectorSearchResult]:
        col_name = _collection_name(user_id)

        filter_expr = ""
        if doc_id_filter:
            filter_expr = f'doc_id == "{doc_id_filter}"'

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            partial(
                self._client.search,
                collection_name=col_name,
                data=[query_vector],
                limit=top_k,
                output_fields=["doc_id", "chunk_id", "text"],
                filter=filter_expr if filter_expr else None,
            ),
        )

        if not results or not results[0]:
            return []

        return [
            VectorSearchResult(
                id=str(hit["id"]),
                doc_id=hit["entity"].get("doc_id", ""),
                chunk_id=hit["entity"].get("chunk_id", ""),
                text=hit["entity"].get("text", ""),
                score=hit["distance"],
            )
            for hit in results[0]
        ]

    async def delete_by_doc(self, user_id: str, doc_id: str) -> int:
        col_name = _collection_name(user_id)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                self._client.delete,
                collection_name=col_name,
                filter=f'doc_id == "{doc_id}"',
            ),
        )
        return result.get("delete_count", 0) if isinstance(result, dict) else 0

    async def delete_collection(self, user_id: str) -> None:
        col_name = _collection_name(user_id)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, partial(self._client.drop_collection, collection_name=col_name)
        )
        self._initialized_collections.discard(col_name)

    async def collection_stats(self, user_id: str) -> dict[str, Any]:
        col_name = _collection_name(user_id)
        loop = asyncio.get_event_loop()

        try:
            stats = await loop.run_in_executor(
                None, partial(self._client.get_collection_stats, collection_name=col_name)
            )
            return {"collection": col_name, "row_count": stats.get("row_count", 0)}
        except Exception:
            return {"collection": col_name, "row_count": 0, "exists": False}

    def close(self) -> None:
        self._client.close()

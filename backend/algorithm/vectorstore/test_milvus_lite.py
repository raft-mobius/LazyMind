"""Tests for MilvusLiteStore."""
import asyncio
import tempfile
import shutil
import pytest
from .milvus_lite import MilvusLiteStore


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def store(temp_dir):
    s = MilvusLiteStore(temp_dir)
    yield s
    s.close()


@pytest.mark.asyncio
async def test_ensure_collection(store):
    await store.ensure_collection("user1", dim=128)
    stats = await store.collection_stats("user1")
    assert stats["collection"] == "lazymind_vectors_user1"


@pytest.mark.asyncio
async def test_insert_and_search(store):
    user_id = "testuser"
    dim = 4
    await store.ensure_collection(user_id, dim=dim)

    vectors = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.5, 0.5, 0.0, 0.0]]
    ids = ["v1", "v2", "v3"]
    doc_ids = ["doc1", "doc1", "doc2"]
    chunk_ids = ["c1", "c2", "c3"]
    texts = ["hello world", "foo bar", "mixed content"]

    await store.insert(user_id, vectors, ids, doc_ids, chunk_ids, texts)

    results = await store.search(user_id, [1.0, 0.0, 0.0, 0.0], top_k=2)
    assert len(results) > 0
    assert results[0].id == "v1"


@pytest.mark.asyncio
async def test_delete_by_doc(store):
    user_id = "testuser"
    dim = 4
    await store.ensure_collection(user_id, dim=dim)

    vectors = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]]
    ids = ["v1", "v2"]
    doc_ids = ["doc1", "doc1"]
    chunk_ids = ["c1", "c2"]
    texts = ["text1", "text2"]

    await store.insert(user_id, vectors, ids, doc_ids, chunk_ids, texts)
    await store.delete_by_doc(user_id, "doc1")

    results = await store.search(user_id, [1.0, 0.0, 0.0, 0.0], top_k=10)
    assert len(results) == 0


@pytest.mark.asyncio
async def test_delete_collection(store):
    user_id = "testuser"
    await store.ensure_collection(user_id, dim=4)
    await store.delete_collection(user_id)
    stats = await store.collection_stats(user_id)
    assert stats.get("exists") is False or stats.get("row_count", 0) == 0


@pytest.mark.asyncio
async def test_search_with_filter(store):
    user_id = "testuser"
    dim = 4
    await store.ensure_collection(user_id, dim=dim)

    vectors = [[1.0, 0.0, 0.0, 0.0], [0.9, 0.1, 0.0, 0.0]]
    ids = ["v1", "v2"]
    doc_ids = ["doc1", "doc2"]
    chunk_ids = ["c1", "c2"]
    texts = ["text1", "text2"]

    await store.insert(user_id, vectors, ids, doc_ids, chunk_ids, texts)

    results = await store.search(user_id, [1.0, 0.0, 0.0, 0.0], top_k=10, doc_id_filter="doc2")
    assert len(results) == 1
    assert results[0].doc_id == "doc2"

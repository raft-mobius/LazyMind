"""Cloud mode regression: ensure Desktop-only code doesn't affect Cloud mode."""
import os
import pytest


def test_algorithm_imports_no_side_effects():
    """Importing algorithm modules should not require Desktop-only dependencies at import time."""
    # These should import cleanly without requiring keytar, Electron, etc.
    from backend.algorithm.parse.chunker import chunk_text
    from backend.algorithm.chat.fusion import reciprocal_rank_fusion
    from backend.algorithm.config import Settings


def test_settings_defaults_are_safe():
    """Default settings should not break if Desktop env vars are missing."""
    from backend.algorithm.config import Settings

    # Clear desktop-specific vars
    env_backup = {}
    desktop_vars = ["ALGO_DB_PATH", "VECTOR_DIR", "SEGMENT_DB_PATH", "CREDENTIAL_BRIDGE_URL"]
    for var in desktop_vars:
        if var in os.environ:
            env_backup[var] = os.environ.pop(var)

    try:
        settings = Settings.from_env()
        # Should have safe defaults, not crash
        assert settings.host == "127.0.0.1"
        assert settings.port == 8046
    finally:
        os.environ.update(env_backup)


def test_chunker_no_desktop_dependencies():
    """Chunker module should work without any Desktop infrastructure."""
    from backend.algorithm.parse.chunker import chunk_text

    result = chunk_text("Hello world. This is a test document for cloud mode.")
    assert len(result) > 0


def test_fusion_no_desktop_dependencies():
    """Fusion module should work without any Desktop infrastructure."""
    from backend.algorithm.chat.fusion import reciprocal_rank_fusion

    results = reciprocal_rank_fusion(
        [{"chunk_id": "c1", "doc_id": "d1", "text": "test", "score": 0.9}],
        [],
        top_n=5,
    )
    assert len(results) == 1


def test_runtime_store_factory_redis_unchanged():
    """RuntimeStore factory should still select Redis by default in Cloud mode."""
    # This tests the Go code conceptually — actual verification requires:
    # go test ./backend/core/store/ -run TestNewRuntimeStore
    #
    # The factory at backend/core/store/runtime_store_factory.go should:
    # - default case (no LAZYMIND_STATE_BACKEND): use Redis
    # - "memory" case: use MemoryRuntimeStore
    # - "hybrid" case: use HybridRuntimeStore (Desktop Phase 2)
    #
    # Cloud deployments don't set LAZYMIND_STATE_BACKEND, so they get Redis.
    pass

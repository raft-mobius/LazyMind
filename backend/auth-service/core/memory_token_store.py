"""In-memory refresh token store for Desktop mode (no Redis required)."""
import json
import threading
import time
import uuid


class MemoryTokenStore:
    """Thread-safe in-memory token store that implements the same interface as refresh_token_store."""

    def __init__(self):
        self._data: dict[str, tuple[str, float]] = {}  # key -> (json_payload, expires_at)
        self._lock = threading.Lock()

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        expires_at = time.time() + ex if ex else float('inf')
        with self._lock:
            self._data[key] = (value, expires_at)

    def get(self, key: str) -> str | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            value, expires_at = item
            if expires_at <= time.time():
                del self._data[key]
                return None
            return value

    def delete(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._data.pop(key, None)


_store = MemoryTokenStore()


def memory_token_store() -> MemoryTokenStore:
    return _store

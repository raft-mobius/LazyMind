"""Refresh token storage: Redis or in-memory (Desktop mode)."""
import json
import logging
import os
import time
import uuid

from core.security import refresh_token_ttl_seconds

logger = logging.getLogger('auth-service')

KEY_PREFIX = 'auth:rt:'

_USE_MEMORY = (os.environ.get('LAZYMIND_STATE_BACKEND') or '').strip().lower() == 'memory'


def _key(token_hash: str) -> str:
    return f'{KEY_PREFIX}{token_hash}'


def _get_store():
    if _USE_MEMORY:
        from core.memory_token_store import memory_token_store
        return memory_token_store()
    from core.redis_client import redis_client
    return redis_client()


def set_refresh_token(token_hash: str, user_id: uuid.UUID) -> None:
    """Store refresh token with TTL and embedded expiry metadata."""
    store = _get_store()
    key = _key(token_hash)
    ttl = refresh_token_ttl_seconds()
    payload = {
        'user_id': str(user_id),
        'expires_at': int(time.time()) + ttl,
    }
    store.set(key, json.dumps(payload), ex=ttl)


def get_user_id_by_token(token_hash: str) -> uuid.UUID | None:
    """Return user_id for token_hash, or None if missing/expired/invalid."""
    store = _get_store()
    key = _key(token_hash)
    val = store.get(key)
    if val is None:
        return None

    try:
        payload = json.loads(val)
    except (TypeError, ValueError):
        return None

    if not isinstance(payload, dict):
        return None

    expires_at = payload.get('expires_at')
    if not isinstance(expires_at, (int, float)):
        return None
    if expires_at <= time.time():
        delete_refresh_token(token_hash)
        return None

    raw_user_id = payload.get('user_id')
    try:
        return uuid.UUID(raw_user_id)
    except (TypeError, ValueError):
        return None


def delete_refresh_token(token_hash: str) -> None:
    """Invalidate this refresh token (delete old token on logout or refresh)."""
    store = _get_store()
    key = _key(token_hash)
    try:
        store.delete(key)
    except Exception as e:
        logger.warning('Delete refresh_token key failed: %s', e)

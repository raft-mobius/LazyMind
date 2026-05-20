"""No-op rate limiter for Desktop mode (no Redis, single-user, no rate limiting needed)."""


class NoOpRateLimiter:
    """Rate limiter that never blocks — used in Desktop mode where there's one local user."""

    def is_limited(self, user_id) -> bool:
        return False

    def record_failure(self, user_id) -> None:
        pass

"""SQLite database connection for algorithm service (algo.db)."""
import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager
from typing import Generator

_DB_PATH: str | None = None


def init_db(db_path: str) -> None:
    """Initialize the database, run migrations, set WAL mode."""
    global _DB_PATH
    _DB_PATH = db_path

    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    with get_connection() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        _run_migrations(conn)


def _run_migrations(conn: sqlite3.Connection) -> None:
    """Run SQL migration files in order."""
    migrations_dir = Path(__file__).parent / "migrations"
    up_files = sorted(migrations_dir.glob("*_init.up.sql"))

    conn.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    for f in up_files:
        row = conn.execute(
            "SELECT 1 FROM _migrations WHERE filename = ?", (f.name,)
        ).fetchone()
        if row is None:
            conn.executescript(f.read_text(encoding="utf-8"))
            conn.execute(
                "INSERT INTO _migrations (filename) VALUES (?)", (f.name,)
            )
    conn.commit()


@contextmanager
def get_connection() -> Generator[sqlite3.Connection, None, None]:
    """Get a database connection with row factory."""
    if _DB_PATH is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

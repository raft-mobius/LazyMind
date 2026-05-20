import os
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker


def _resolve_database_url() -> str:
    return os.environ.get('LAZYMIND_DATABASE_URL') or 'sqlite:///./app.db'


DATABASE_URL = _resolve_database_url()
connect_args = {'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {}

engine: Engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)

if DATABASE_URL.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL')
        cursor.execute('PRAGMA busy_timeout=5000')
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.execute('PRAGMA synchronous=NORMAL')
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

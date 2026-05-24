"""Configuration for algorithm service."""
import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8046
    debug: bool = False

    # Database
    algo_db_path: str = ""
    segment_db_path: str = ""
    vector_dir: str = ""

    # Security
    local_secret: str = ""

    # Model defaults
    default_embedding_model: str = "text-embedding-v3"
    default_chat_model: str = "qwen-plus"
    embedding_dim: int = 1024

    # Service URLs
    core_url: str = "http://127.0.0.1:8001"
    credential_bridge_url: str = "http://127.0.0.1:5023"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host=os.getenv("SERVER_HOST", "127.0.0.1"),
            port=int(os.getenv("SERVER_PORT", "8046")),
            debug=os.getenv("LAZYMIND_DEBUG", "").lower() == "true",
            algo_db_path=os.getenv("ALGO_DB_PATH", ""),
            segment_db_path=os.getenv("SEGMENT_DB_PATH", ""),
            vector_dir=os.getenv("VECTOR_DIR", ""),
            local_secret=os.getenv("LAZYMIND_LOCAL_SECRET", ""),
            default_embedding_model=os.getenv("DEFAULT_EMBEDDING_MODEL", "text-embedding-v3"),
            default_chat_model=os.getenv("DEFAULT_CHAT_MODEL", "qwen-plus"),
            embedding_dim=int(os.getenv("EMBEDDING_DIM", "1024")),
            core_url=os.getenv("CORE_URL", "http://127.0.0.1:8001"),
            credential_bridge_url=os.getenv("CREDENTIAL_BRIDGE_URL", "http://127.0.0.1:5023"),
        )


settings = Settings.from_env()

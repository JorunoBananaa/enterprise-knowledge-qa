from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings


DEVELOPMENT_JWT_SECRET = "local-dev-secret"


class Settings(BaseSettings):
    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/knowledge_qa"
    jwt_secret: str = DEVELOPMENT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    auth_cookie_name: str = "access_token"
    auth_cookie_secure: bool = False
    seed_development_users: bool = False
    development_seed_password: str | None = None

    upload_dir: str = "storage/uploads"
    upload_max_file_size_bytes: int = 25 * 1024 * 1024
    upload_max_files_per_request: int = 10
    upload_allowed_extensions: str = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv"
    upload_max_archive_entries: int = 5000
    upload_max_archive_uncompressed_bytes: int = 100 * 1024 * 1024
    upload_max_archive_compression_ratio: int = 200

    embedding_provider: str = "ollama"
    embedding_model_name: str = "qwen3-embedding:latest"
    embedding_dimension: int = 4096
    ollama_base_url: str = "http://127.0.0.1:12434/v1"
    model_base_url_allowlist: str = ""
    retrieval_candidate_k: int = 20
    retrieval_max_evidence: int = 5
    retrieval_min_similarity: float = 0.50
    retrieval_policy_id: str = "cosine-initial-v1"

    paddleocr_token: str | None = None
    paddleocr_http_timeout_seconds: float = 30.0
    paddleocr_max_wait_seconds: float = 300.0
    paddleocr_max_result_bytes: int = 10 * 1024 * 1024
    paddleocr_result_host_allowlist: str = "paddleocr.aistudio-app.com"

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        if self.environment == "production":
            if (
                self.jwt_secret == DEVELOPMENT_JWT_SECRET
                or len(self.jwt_secret) < 32
            ):
                raise ValueError("生产环境 JWT_SECRET 必须是至少 32 字符的独立密钥")
            if not self.auth_cookie_secure:
                raise ValueError("生产环境必须启用 AUTH_COOKIE_SECURE")
            if self.seed_development_users:
                raise ValueError("生产环境禁止创建开发种子用户")

        if self.seed_development_users:
            if self.environment != "development":
                raise ValueError("种子用户只能在 development 环境显式启用")
            if (
                not self.development_seed_password
                or len(self.development_seed_password) < 12
            ):
                raise ValueError("DEVELOPMENT_SEED_PASSWORD 至少需要 12 个字符")

        if self.upload_max_file_size_bytes <= 0:
            raise ValueError("UPLOAD_MAX_FILE_SIZE_BYTES 必须大于 0")
        if self.upload_max_files_per_request <= 0:
            raise ValueError("UPLOAD_MAX_FILES_PER_REQUEST 必须大于 0")
        if self.retrieval_candidate_k <= 0:
            raise ValueError("RETRIEVAL_CANDIDATE_K must be greater than 0")
        if self.retrieval_max_evidence <= 0:
            raise ValueError("RETRIEVAL_MAX_EVIDENCE must be greater than 0")
        if self.retrieval_max_evidence > self.retrieval_candidate_k:
            raise ValueError(
                "RETRIEVAL_MAX_EVIDENCE must not exceed RETRIEVAL_CANDIDATE_K"
            )
        if not -1.0 <= self.retrieval_min_similarity <= 1.0:
            raise ValueError(
                "RETRIEVAL_MIN_SIMILARITY must be between -1.0 and 1.0"
            )
        if not self.retrieval_policy_id.strip():
            raise ValueError("RETRIEVAL_POLICY_ID must not be blank")
        return self


settings = Settings()

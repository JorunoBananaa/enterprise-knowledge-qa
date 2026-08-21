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
    embedding_model_name: str = "dengcao/Qwen3-Embedding-8B:Q4_K_M"
    embedding_dimension: int = 4096
    ollama_base_url: str = "http://localhost:11434/v1"
    model_base_url_allowlist: str = ""

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
        return self


settings = Settings()

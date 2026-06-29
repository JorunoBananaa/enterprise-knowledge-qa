from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/knowledge_qa"
    jwt_secret: str = "local-dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    auth_cookie_name: str = "access_token"
    auth_cookie_secure: bool = False
    upload_dir: str = "storage/uploads"
    embedding_provider: str = "ollama"
    embedding_model_name: str = "dengcao/Qwen3-Embedding-8B:Q4_K_M"
    embedding_dimension: int = 4096
    ollama_base_url: str = "http://localhost:11434/v1"


settings = Settings()

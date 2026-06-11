from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///storage/knowledge_qa.db"
    jwt_secret: str = "local-dev-secret"
    jwt_algorithm: str = "HS256"
    upload_dir: str = "storage/uploads"
    llm_provider: str = "fake"
    embedding_provider: str = "fake"


settings = Settings()

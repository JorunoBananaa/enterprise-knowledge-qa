from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///storage/knowledge_qa.db"
    jwt_secret: str = "local-dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    auth_cookie_name: str = "access_token"
    auth_cookie_secure: bool = False
    upload_dir: str = "storage/uploads"
    llm_provider: str = "fake"
    embedding_provider: str = "fake"


settings = Settings()

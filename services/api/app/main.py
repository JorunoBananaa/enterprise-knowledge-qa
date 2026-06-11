from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  # register all models with Base.metadata
from app.api.routes.auth import router as auth_router
from app.api.routes.documents import router as documents_router
from app.api.routes.llm_config import router as llm_config_router
from app.api.routes.prompts import router as prompts_router
from app.api.routes.qa import router as qa_router
from app.api.routes.review import router as review_router
from app.api.routes.users import router as users_router
from app.db.base import Base
from app.db.session import SessionLocal, engine


def _seed_database() -> None:
    """Create tables and seed MVP users + default category if missing."""
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        from app.core.security import hash_password
        from app.models.user import User, UserRole, UserStatus
        from app.models.category import KnowledgeCategory

        # Seed MVP users
        if db.query(User).filter(User.username == "admin").first() is None:
            db.add(User(
                username="admin",
                display_name="Administrator",
                password_hash=hash_password("admin123"),
                role=UserRole.ADMIN,
                status=UserStatus.ACTIVE,
                token_version=0,
            ))
        if db.query(User).filter(User.username == "user").first() is None:
            db.add(User(
                username="user",
                display_name="Standard User",
                password_hash=hash_password("user123"),
                role=UserRole.STANDARD,
                status=UserStatus.ACTIVE,
                token_version=0,
            ))
        db.commit()

        # Seed default category
        if db.query(KnowledgeCategory).filter(KnowledgeCategory.name == "产品 A").first() is None:
            db.add(KnowledgeCategory(name="产品 A"))
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _seed_database()
    yield


app = FastAPI(title="Enterprise Knowledge QA API", lifespan=lifespan, redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(documents_router, prefix="/documents", tags=["documents"])
app.include_router(llm_config_router, prefix="/llm-configs", tags=["llm-configs"])
app.include_router(prompts_router, prefix="/prompts", tags=["prompts"])
app.include_router(qa_router, prefix="/qa", tags=["qa"])
app.include_router(review_router, prefix="/review", tags=["review"])
app.include_router(users_router, prefix="/users", tags=["users"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

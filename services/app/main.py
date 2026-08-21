from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import app.models  # noqa: F401  # 将所有模型注册到 Base.metadata
from app.api.routes.auth import router as auth_router
from app.api.routes.categories import router as categories_router
from app.api.routes.documents import router as documents_router
from app.api.routes.llm_config import router as llm_config_router
from app.api.routes.prompts import router as prompts_router
from app.api.routes.qa import router as qa_router
from app.api.routes.review import router as review_router
from app.api.routes.users import router as users_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import SessionLocal, engine


def _initialize_database() -> None:
    """创建当前 MVP Schema；后续由 Alembic 迁移替换。"""
    # 创建依赖 VECTOR 类型的数据表前，先启用 pgvector 扩展
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    _ensure_citation_document_delete_behavior()
    _ensure_chat_session_branching_columns()

    _seed_development_users()
    _reject_legacy_weak_users_in_production()


def _seed_development_users() -> None:
    """仅在开发环境显式启用时创建本地演示用户。"""
    if not settings.seed_development_users:
        return

    password = settings.development_seed_password
    if password is None:  # Settings 校验负责给出配置错误；这里保持类型安全。
        raise RuntimeError("DEVELOPMENT_SEED_PASSWORD 未配置")

    db = SessionLocal()
    try:
        from app.core.security import hash_password
        from app.models.user import User, UserRole, UserStatus

        if db.query(User).filter(User.username == "admin").first() is None:
            db.add(User(
                username="admin",
                display_name="Administrator",
                password_hash=hash_password(password),
                role=UserRole.ADMIN,
                status=UserStatus.ACTIVE,
                token_version=0,
            ))
        if db.query(User).filter(User.username == "user").first() is None:
            db.add(User(
                username="user",
                display_name="Standard User",
                password_hash=hash_password(password),
                role=UserRole.STANDARD,
                status=UserStatus.ACTIVE,
                token_version=0,
            ))
        db.commit()

    finally:
        db.close()


def _reject_legacy_weak_users_in_production() -> None:
    """阻止带有历史演示弱口令的数据库进入生产服务。"""
    if settings.environment != "production":
        return

    from app.core.security import verify_password
    from app.models.user import User

    db = SessionLocal()
    try:
        legacy_users = (
            db.query(User)
            .filter(User.username.in_(["admin", "user"]))
            .all()
        )
        if any(verify_password("a", user.password_hash) for user in legacy_users):
            raise RuntimeError(
                "检测到历史演示弱口令账号；请先重置 admin/user 密码再启动生产服务"
            )
    finally:
        db.close()


def _ensure_citation_document_delete_behavior() -> None:
    """Keep historical citations when their source document is deleted."""
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE citations ALTER COLUMN document_id DROP NOT NULL"))
        conn.execute(
            text(
                """
                DO $$
                DECLARE
                    existing_constraint text;
                BEGIN
                    SELECT tc.constraint_name
                    INTO existing_constraint
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_schema = current_schema()
                      AND tc.table_name = 'citations'
                      AND kcu.column_name = 'document_id'
                    LIMIT 1;

                    IF existing_constraint IS NOT NULL THEN
                        EXECUTE format(
                            'ALTER TABLE citations DROP CONSTRAINT %I',
                            existing_constraint
                        );
                    END IF;

                    ALTER TABLE citations
                    ADD CONSTRAINT citations_document_id_fkey
                    FOREIGN KEY (document_id)
                    REFERENCES knowledge_documents(id)
                    ON DELETE SET NULL;
                END $$;
                """
            )
        )


def _ensure_chat_session_branching_columns() -> None:
    """阶段 3 引入 Alembic 前，兼容已有开发数据库的会话分支字段。"""
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE chat_sessions
                    ADD COLUMN IF NOT EXISTS parent_session_id integer,
                    ADD COLUMN IF NOT EXISTS branch_from_message_id integer,
                    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
                    ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'active'
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE chat_messages
                    ADD COLUMN IF NOT EXISTS request_id varchar(64)
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_messages_request_id
                ON chat_messages (request_id)
                WHERE request_id IS NOT NULL
                """
            )
        )
        conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'chat_sessions_parent_session_id_fkey'
                    ) THEN
                        ALTER TABLE chat_sessions
                        ADD CONSTRAINT chat_sessions_parent_session_id_fkey
                        FOREIGN KEY (parent_session_id)
                        REFERENCES chat_sessions(id)
                        ON DELETE SET NULL;
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'chat_sessions_branch_from_message_id_fkey'
                    ) THEN
                        ALTER TABLE chat_sessions
                        ADD CONSTRAINT chat_sessions_branch_from_message_id_fkey
                        FOREIGN KEY (branch_from_message_id)
                        REFERENCES chat_messages(id)
                        ON DELETE SET NULL;
                    END IF;
                END $$;
                """
            )
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _initialize_database()
    yield


app = FastAPI(title="Knowledge QA API", lifespan=lifespan, redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(categories_router, prefix="/categories", tags=["categories"])
app.include_router(documents_router, prefix="/documents", tags=["documents"])
app.include_router(llm_config_router, prefix="/llm-configs", tags=["llm-configs"])
app.include_router(prompts_router, prefix="/prompts", tags=["prompts"])
app.include_router(qa_router, prefix="/qa", tags=["qa"])
app.include_router(review_router, prefix="/review", tags=["review"])
app.include_router(users_router, prefix="/users", tags=["users"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

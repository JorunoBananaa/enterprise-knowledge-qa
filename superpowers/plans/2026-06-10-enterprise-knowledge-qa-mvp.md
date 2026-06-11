# Enterprise Knowledge QA MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working MVP for a knowledge-management-first enterprise Q&A system with login, document upload, review, indexing, LangChain-based grounded Q&A, citations, and prompt management.

**Architecture:** Use a monorepo with a FastAPI backend and a Next.js frontend. The backend owns auth, document lifecycle, prompt policy, synchronous indexing, and LangChain RAG orchestration. PostgreSQL stores relational data and pgvector embeddings; local file storage is used for the first runnable version.

**Tech Stack:** Python, FastAPI, SQLAlchemy, Alembic, PostgreSQL, pgvector, LangChain, pypdf, python-docx, python-pptx, openpyxl, pytest, Next.js, React, TypeScript, Playwright.

---

## Scope For This Plan

This plan implements one vertical MVP:

- JWT login with administrator and standard-user roles.
- Product/module categories.
- Document upload for PDF, Word, PowerPoint, and Excel.
- Review workflow with approval and rejection.
- Synchronous indexing after approval.
- LangChain retrieval and answer generation over approved indexed documents.
- Citations for answer sources.
- Insufficient-evidence refusal.
- System prompt management for administrators.
- Personal prompt settings for standard users.
- Desktop-first web screens with basic responsive behavior.

The plan does not include external integrations, multi-tenancy, OCR, complex analytics, or production deployment.

## File Structure

Create this structure under `/Users/jorunobanana/enterprise-knowledge-qa`:

```text
apps/web-app/
  package.json
  next.config.mjs
  tsconfig.json
  playwright.config.ts
  src/app/layout.tsx
  src/app/login/page.tsx
  src/app/library/page.tsx
  src/app/library/upload/page.tsx
  src/app/library/[id]/page.tsx
  src/app/review/page.tsx
  src/app/qa/page.tsx
  src/app/prompts/system/page.tsx
  src/app/prompts/me/page.tsx
  src/app/users/page.tsx
  src/components/AppShell.tsx
  src/components/CitationList.tsx
  src/components/DocumentStatusBadge.tsx
  src/lib/api.ts
  src/lib/auth.ts
  tests/smoke.spec.ts
services/api/
  pyproject.toml
  alembic.ini
  app/main.py
  app/core/config.py
  app/core/security.py
  app/db/session.py
  app/db/base.py
  app/models/user.py
  app/models/category.py
  app/models/document.py
  app/models/prompt.py
  app/models/chat.py
  app/schemas/auth.py
  app/schemas/category.py
  app/schemas/document.py
  app/schemas/prompt.py
  app/schemas/chat.py
  app/api/deps.py
  app/api/routes/auth.py
  app/api/routes/categories.py
  app/api/routes/documents.py
  app/api/routes/review.py
  app/api/routes/prompts.py
  app/api/routes/qa.py
  app/services/storage.py
  app/services/ingestion.py
  app/services/indexing.py
  app/services/rag.py
  app/services/prompt_composer.py
  app/repositories/documents.py
  app/repositories/prompts.py
  tests/conftest.py
  tests/test_auth.py
  tests/test_document_review.py
  tests/test_prompt_composer.py
  tests/test_rag_grounding.py
infra/docker-compose.yml
README.md
```

Responsibilities:

- `services/api/app/models/*`: database persistence models only.
- `services/api/app/schemas/*`: request and response schemas only.
- `services/api/app/api/routes/*`: HTTP endpoint wiring and permission checks.
- `services/api/app/services/*`: business workflows, parsing, indexing, RAG, prompt composition.
- `services/api/app/repositories/*`: focused database queries that are reused across routes and services.
- `apps/web-app/src/lib/*`: frontend API client and token handling.
- `apps/web-app/src/components/*`: shared UI components.
- `apps/web-app/src/app/*`: route-level pages and page-specific state.

## Task 1: Backend Project Foundation

**Files:**
- Create: `services/api/pyproject.toml`
- Create: `services/api/app/main.py`
- Create: `services/api/app/core/config.py`
- Create: `services/api/tests/test_health.py`

- [ ] **Step 1: Write the failing health test**

Create `services/api/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint_returns_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Run the health test to verify it fails**

Run:

```bash
cd services/api
python -m pytest tests/test_health.py -q
```

Expected: FAIL because `app.main` or `/health` is not available.

- [ ] **Step 3: Create the FastAPI foundation**

Create `services/api/pyproject.toml` with these dependencies:

```toml
[project]
name = "enterprise-knowledge-qa-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi",
  "uvicorn[standard]",
  "pydantic-settings",
  "sqlalchemy",
  "alembic",
  "psycopg[binary]",
  "pgvector",
  "python-jose[cryptography]",
  "passlib[bcrypt]",
  "python-multipart",
  "langchain",
  "langchain-community",
  "pypdf",
  "python-docx",
  "python-pptx",
  "openpyxl",
]

[project.optional-dependencies]
dev = [
  "pytest",
  "pytest-asyncio",
  "httpx",
]

[tool.pytest.ini_options]
pythonpath = ["."]
```

Create `services/api/app/core/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/knowledge_qa"
    jwt_secret: str = "local-dev-secret"
    jwt_algorithm: str = "HS256"
    upload_dir: str = "storage/uploads"
    llm_provider: str = "fake"
    embedding_provider: str = "fake"


settings = Settings()
```

Create `services/api/app/main.py`:

```python
from fastapi import FastAPI

app = FastAPI(title="Enterprise Knowledge QA API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Run the health test to verify it passes**

Run:

```bash
cd services/api
python -m pytest tests/test_health.py -q
```

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add services/api/pyproject.toml services/api/app/main.py services/api/app/core/config.py services/api/tests/test_health.py
git commit -m "feat: scaffold FastAPI backend"
```

## Task 2: Database Models And Test Database Setup

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `services/api/app/db/session.py`
- Create: `services/api/app/db/base.py`
- Create: `services/api/app/models/user.py`
- Create: `services/api/app/models/category.py`
- Create: `services/api/app/models/document.py`
- Create: `services/api/app/models/prompt.py`
- Create: `services/api/app/models/chat.py`
- Create: `services/api/tests/conftest.py`
- Create: `services/api/tests/test_document_review.py`

- [ ] **Step 1: Write failing model tests**

Create `services/api/tests/test_document_review.py`:

```python
from app.models.document import DocumentReviewStatus, KnowledgeDocument


def test_new_document_starts_pending_review():
    document = KnowledgeDocument(
        title="Product FAQ",
        file_type="pdf",
        storage_path="storage/uploads/product-faq.pdf",
        uploader_id=1,
        category_id=1,
    )
    assert document.review_status == DocumentReviewStatus.PENDING_REVIEW
    assert document.index_status == "not_indexed"
```

- [ ] **Step 2: Run the model test to verify it fails**

Run:

```bash
cd services/api
python -m pytest tests/test_document_review.py -q
```

Expected: FAIL because document models do not exist.

- [ ] **Step 3: Add database infrastructure**

Create `infra/docker-compose.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: knowledge_qa
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Create `services/api/app/db/base.py`:

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

Create `services/api/app/db/session.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
```

- [ ] **Step 4: Add persistence models**

Create the models with these enum values and defaults:

```python
# services/api/app/models/document.py
import enum

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocumentReviewStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class DocumentIndexStatus(str, enum.Enum):
    NOT_INDEXED = "not_indexed"
    INDEXING = "indexing"
    INDEXED = "indexed"
    FAILED = "failed"


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(32))
    storage_path: Mapped[str] = mapped_column(Text)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("knowledge_categories.id"))
    review_status: Mapped[DocumentReviewStatus] = mapped_column(default=DocumentReviewStatus.PENDING_REVIEW)
    index_status: Mapped[str] = mapped_column(String(32), default=DocumentIndexStatus.NOT_INDEXED.value)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Create `services/api/app/models/user.py`:

```python
import enum

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    STANDARD = "standard"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(default=UserRole.STANDARD)
    status: Mapped[str] = mapped_column(String(32), default="active")
```

Create `services/api/app/models/category.py`:

```python
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KnowledgeCategory(Base):
    __tablename__ = "knowledge_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("knowledge_categories.id"), nullable=True)
```

Create `services/api/app/models/prompt.py`:

```python
import enum

from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PromptStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(index=True)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[PromptStatus] = mapped_column(default=PromptStatus.DRAFT)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class UserPrompt(Base):
    __tablename__ = "user_prompts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    content: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(default=True)
    version: Mapped[int] = mapped_column(default=1)
```

Create `services/api/app/models/chat.py`:

```python
from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    result_status: Mapped[str] = mapped_column(default="answered")
    system_prompt_version: Mapped[int | None] = mapped_column(nullable=True)
    user_prompt_version: Mapped[int | None] = mapped_column(nullable=True)


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id"))
    document_id: Mapped[int] = mapped_column(ForeignKey("knowledge_documents.id"))
    chunk_id: Mapped[int]
    locator: Mapped[str] = mapped_column(Text)
    quoted_text_preview: Mapped[str] = mapped_column(Text)
    rank: Mapped[int] = mapped_column(default=1)
```

- [ ] **Step 5: Run model tests**

Run:

```bash
cd services/api
python -m pytest tests/test_document_review.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/docker-compose.yml services/api/app/db services/api/app/models services/api/tests
git commit -m "feat: add database models"
```

## Task 3: Auth And RBAC API

**Files:**
- Create: `services/api/app/core/security.py`
- Create: `services/api/app/schemas/auth.py`
- Create: `services/api/app/api/deps.py`
- Create: `services/api/app/api/routes/auth.py`
- Modify: `services/api/app/main.py`
- Create: `services/api/tests/test_auth.py`

- [ ] **Step 1: Write failing auth tests**

Create `services/api/tests/test_auth.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_login_returns_access_token():
    client = TestClient(app)
    response = client.post("/auth/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


def test_me_requires_token():
    client = TestClient(app)
    response = client.get("/auth/me")
    assert response.status_code == 401
```

- [ ] **Step 2: Run auth tests to verify they fail**

Run:

```bash
cd services/api
python -m pytest tests/test_auth.py -q
```

Expected: FAIL because auth routes do not exist.

- [ ] **Step 3: Implement token helpers and auth routes**

Expose these behavior contracts:

```python
# services/api/app/core/security.py
def create_access_token(subject: str, role: str) -> str:
    """Return a signed JWT with subject and role claims."""


def decode_access_token(token: str) -> dict[str, str]:
    """Return JWT claims or raise an HTTP 401-compatible error."""
```

```python
# services/api/app/api/routes/auth.py
@router.post("/login")
def login(payload: LoginRequest) -> TokenResponse:
    """Accept admin/admin123 for the seeded administrator in the MVP."""


@router.get("/me")
def me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Return the current token subject and role."""
```

Register the router in `app/main.py` under `/auth`.

- [ ] **Step 4: Run auth tests**

Run:

```bash
cd services/api
python -m pytest tests/test_auth.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/core/security.py services/api/app/schemas/auth.py services/api/app/api services/api/app/main.py services/api/tests/test_auth.py
git commit -m "feat: add auth and role dependencies"
```

## Task 4: Document Upload, Review, And Indexing Workflow

**Files:**
- Create: `services/api/app/schemas/document.py`
- Create: `services/api/app/api/routes/documents.py`
- Create: `services/api/app/api/routes/review.py`
- Create: `services/api/app/services/storage.py`
- Create: `services/api/app/services/ingestion.py`
- Create: `services/api/app/services/indexing.py`
- Create: `services/api/repositories/documents.py`
- Modify: `services/api/app/main.py`
- Modify: `services/api/tests/test_document_review.py`

- [ ] **Step 1: Extend failing workflow tests**

Add these tests to `services/api/tests/test_document_review.py`:

```python
def test_uploaded_document_is_pending_review(client, standard_user_token):
    response = client.post(
        "/documents",
        headers={"Authorization": f"Bearer {standard_user_token}"},
        files={"file": ("faq.pdf", b"%PDF-1.4 test", "application/pdf")},
        data={"title": "FAQ", "category_id": "1"},
    )
    assert response.status_code == 201
    assert response.json()["review_status"] == "pending_review"


def test_admin_approval_indexes_document(client, admin_token, pending_document_id):
    response = client.post(
        f"/review/documents/{pending_document_id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200
    assert response.json()["review_status"] == "approved"
    assert response.json()["index_status"] in ["indexed", "failed"]
```

- [ ] **Step 2: Run workflow tests to verify they fail**

Run:

```bash
cd services/api
python -m pytest tests/test_document_review.py -q
```

Expected: FAIL because routes and test fixtures are not complete.

- [ ] **Step 3: Implement upload and storage**

Implement `services/api/app/services/storage.py` with this public method:

```python
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings


def save_upload(file: UploadFile) -> str:
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix
    target = upload_dir / f"{uuid4().hex}{suffix}"
    with target.open("wb") as handle:
        handle.write(file.file.read())
    return str(target)
```

Implement `/documents` upload so standard users and administrators can create pending documents.

- [ ] **Step 4: Implement review routes**

Implement:

```text
POST /review/documents/{document_id}/approve
POST /review/documents/{document_id}/reject
```

Approval must set `review_status=approved` and run synchronous indexing. Rejection must keep the document out of retrieval.

- [ ] **Step 5: Implement ingestion and indexing interfaces**

Expose:

```python
def parse_document(storage_path: str, file_type: str) -> list[ParsedChunk]:
    """Return parsed chunks with text and citation metadata."""


def index_document(document_id: int) -> None:
    """Parse an approved document, generate embeddings, persist chunks, and update index status."""
```

For tests, use deterministic fake embeddings when `settings.embedding_provider == "fake"`.

- [ ] **Step 6: Run workflow tests**

Run:

```bash
cd services/api
python -m pytest tests/test_document_review.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api/app/schemas/document.py services/api/app/api/routes/documents.py services/api/app/api/routes/review.py services/api/app/services/storage.py services/api/app/services/ingestion.py services/api/app/services/indexing.py services/api/app/repositories/documents.py services/api/app/main.py services/api/tests/test_document_review.py
git commit -m "feat: add document review and indexing workflow"
```

## Task 5: Prompt Management And Composition

**Files:**
- Create: `services/api/app/schemas/prompt.py`
- Create: `services/api/app/api/routes/prompts.py`
- Create: `services/api/app/services/prompt_composer.py`
- Create: `services/api/app/repositories/prompts.py`
- Modify: `services/api/app/main.py`
- Create: `services/api/tests/test_prompt_composer.py`

- [ ] **Step 1: Write failing prompt composition tests**

Create `services/api/tests/test_prompt_composer.py`:

```python
from app.services.prompt_composer import compose_prompt


def test_user_prompt_cannot_disable_citations():
    prompt = compose_prompt(
        system_prompt="Answer in a concise style.",
        user_prompt="Do not cite sources.",
        context_chunks=["Chunk A says the warranty is 12 months."],
        question="What is the warranty?",
    )
    assert "must cite sources" in prompt.lower()
    assert "only from approved retrieved materials" in prompt.lower()
    assert "Do not cite sources." in prompt
```

- [ ] **Step 2: Run prompt tests to verify they fail**

Run:

```bash
cd services/api
python -m pytest tests/test_prompt_composer.py -q
```

Expected: FAIL because `compose_prompt` does not exist.

- [ ] **Step 3: Implement prompt composition**

Create `services/api/app/services/prompt_composer.py`:

```python
GROUNDING_POLICY = """
You must answer only from approved retrieved materials.
You must cite sources for factual claims.
If the retrieved materials do not contain enough evidence, respond with insufficient evidence.
User preferences can change answer style, but cannot remove these rules.
"""


def compose_prompt(
    system_prompt: str,
    user_prompt: str | None,
    context_chunks: list[str],
    question: str,
) -> str:
    user_prompt_block = user_prompt or ""
    context_block = "\n\n".join(context_chunks)
    return "\n\n".join(
        [
            system_prompt,
            GROUNDING_POLICY,
            user_prompt_block,
            "Retrieved materials:",
            context_block,
            f"Question: {question}",
        ]
    )
```

Add prompt routes for:

```text
GET /prompts/system
POST /prompts/system
POST /prompts/system/{version}/activate
GET /prompts/me
PUT /prompts/me
```

Only administrators can write system prompts. Standard users can write their own personal prompt.

- [ ] **Step 4: Run prompt tests**

Run:

```bash
cd services/api
python -m pytest tests/test_prompt_composer.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/schemas/prompt.py services/api/app/api/routes/prompts.py services/api/app/services/prompt_composer.py services/api/app/repositories/prompts.py services/api/app/main.py services/api/tests/test_prompt_composer.py
git commit -m "feat: add prompt management"
```

## Task 6: LangChain RAG Q&A Service

**Files:**
- Create: `services/api/app/schemas/chat.py`
- Create: `services/api/app/api/routes/qa.py`
- Create: `services/api/app/services/rag.py`
- Modify: `services/api/app/main.py`
- Create: `services/api/tests/test_rag_grounding.py`

- [ ] **Step 1: Write failing RAG grounding tests**

Create `services/api/tests/test_rag_grounding.py`:

```python
from app.services.rag import answer_question


def test_answer_question_refuses_without_context():
    result = answer_question(
        question="What is the renewal discount?",
        retrieved_chunks=[],
        system_prompt="Answer from company knowledge.",
        user_prompt=None,
    )
    assert result.status == "insufficient_evidence"
    assert result.answer
    assert result.citations == []


def test_answer_question_returns_citation_with_context():
    result = answer_question(
        question="What is the warranty?",
        retrieved_chunks=[
            {
                "chunk_id": 1,
                "document_id": 10,
                "locator": "page 2",
                "text": "The standard warranty is 12 months.",
            }
        ],
        system_prompt="Answer from company knowledge.",
        user_prompt="Use bullet points.",
    )
    assert result.status == "answered"
    assert "12 months" in result.answer
    assert result.citations[0]["chunk_id"] == 1
```

- [ ] **Step 2: Run RAG tests to verify they fail**

Run:

```bash
cd services/api
python -m pytest tests/test_rag_grounding.py -q
```

Expected: FAIL because `answer_question` does not exist.

- [ ] **Step 3: Implement deterministic RAG service contract**

Create `services/api/app/services/rag.py` with these public types and function:

```python
from dataclasses import dataclass
from typing import Any

from app.services.prompt_composer import compose_prompt


@dataclass
class RagResult:
    status: str
    answer: str
    citations: list[dict[str, Any]]


def answer_question(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str,
    user_prompt: str | None,
) -> RagResult:
    if not retrieved_chunks:
        return RagResult(
            status="insufficient_evidence",
            answer="The approved knowledge base does not contain enough evidence to answer this question.",
            citations=[],
        )

    prompt = compose_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        context_chunks=[chunk["text"] for chunk in retrieved_chunks],
        question=question,
    )
    first_chunk = retrieved_chunks[0]
    return RagResult(
        status="answered",
        answer=f"{first_chunk['text']}\n\nSource: {first_chunk['locator']}",
        citations=[
            {
                "document_id": first_chunk["document_id"],
                "chunk_id": first_chunk["chunk_id"],
                "locator": first_chunk["locator"],
            }
        ],
    )
```

This deterministic implementation is the first testable seam. Replace the answer body with a LangChain chat model call after the tests protect refusal and citation behavior.

- [ ] **Step 4: Add Q&A route**

Implement:

```text
POST /qa/ask
```

The route must:

- Require login.
- Load active system prompt.
- Load current user's enabled personal prompt.
- Retrieve only approved indexed chunks.
- Return `status`, `answer`, and `citations`.
- Persist chat message and citation records.

- [ ] **Step 5: Run RAG tests**

Run:

```bash
cd services/api
python -m pytest tests/test_rag_grounding.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/schemas/chat.py services/api/app/api/routes/qa.py services/api/app/services/rag.py services/api/app/main.py services/api/tests/test_rag_grounding.py
git commit -m "feat: add grounded qa service"
```

## Task 7: Frontend Foundation And Login

**Files:**
- Create: `apps/web-app/package.json`
- Create: `apps/web-app/next.config.mjs`
- Create: `apps/web-app/tsconfig.json`
- Create: `apps/web-app/src/app/layout.tsx`
- Create: `apps/web-app/src/app/login/page.tsx`
- Create: `apps/web-app/src/components/AppShell.tsx`
- Create: `apps/web-app/src/lib/api.ts`
- Create: `apps/web-app/src/lib/auth.ts`
- Create: `apps/web-app/tests/smoke.spec.ts`

- [ ] **Step 1: Write failing Playwright smoke test**

Create `apps/web-app/tests/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("login page shows product name and login controls", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Enterprise Knowledge QA" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
```

- [ ] **Step 2: Run smoke test to verify it fails**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium tests/smoke.spec.ts
```

Expected: FAIL because the Next.js app does not exist.

- [ ] **Step 3: Create frontend foundation**

Create a Next.js app with:

- `src/app/layout.tsx` as the shared root layout.
- `src/lib/api.ts` exporting an authenticated fetch wrapper.
- `src/lib/auth.ts` storing and reading the access token.
- `src/components/AppShell.tsx` rendering desktop-first navigation.
- `src/app/login/page.tsx` posting to `/auth/login` and storing the token.

The login page must use labels `Username` and `Password`, and button text `Sign in`.

- [ ] **Step 4: Run smoke test**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium tests/smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-app
git commit -m "feat: add frontend login shell"
```

## Task 8: Frontend Knowledge Library And Review Pages

**Files:**
- Create: `apps/web-app/src/app/library/page.tsx`
- Create: `apps/web-app/src/app/library/upload/page.tsx`
- Create: `apps/web-app/src/app/library/[id]/page.tsx`
- Create: `apps/web-app/src/app/review/page.tsx`
- Create: `apps/web-app/src/components/DocumentStatusBadge.tsx`
- Modify: `apps/web-app/tests/smoke.spec.ts`

- [ ] **Step 1: Add failing library smoke test**

Extend `apps/web-app/tests/smoke.spec.ts`:

```ts
test("library page exposes filters and upload action", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Knowledge Library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload document" })).toBeVisible();
  await expect(page.getByLabel("Category")).toBeVisible();
  await expect(page.getByLabel("Review status")).toBeVisible();
});
```

- [ ] **Step 2: Run smoke test to verify it fails**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium tests/smoke.spec.ts
```

Expected: FAIL because `/library` is not implemented.

- [ ] **Step 3: Implement library pages**

Implement:

- `/library`: document table with category, review status, index status, uploader, and actions.
- `/library/upload`: file upload form with title, category, and file picker.
- `/library/[id]`: metadata, review status, index status, review history, and parsed chunk preview.
- `/review`: administrator queue with approve and reject actions.

Use `DocumentStatusBadge` for review and index status display.

- [ ] **Step 4: Run smoke test**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium tests/smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-app/src/app/library apps/web-app/src/app/review apps/web-app/src/components/DocumentStatusBadge.tsx apps/web-app/tests/smoke.spec.ts
git commit -m "feat: add knowledge library screens"
```

## Task 9: Frontend Q&A And Prompt Pages

**Files:**
- Create: `apps/web-app/src/app/qa/page.tsx`
- Create: `apps/web-app/src/app/prompts/system/page.tsx`
- Create: `apps/web-app/src/app/prompts/me/page.tsx`
- Create: `apps/web-app/src/components/CitationList.tsx`
- Modify: `apps/web-app/tests/smoke.spec.ts`

- [ ] **Step 1: Add failing Q&A and prompt smoke tests**

Extend `apps/web-app/tests/smoke.spec.ts`:

```ts
test("qa page shows question input and citation area", async ({ page }) => {
  await page.goto("/qa");
  await expect(page.getByRole("heading", { name: "Ask Knowledge Base" })).toBeVisible();
  await expect(page.getByLabel("Question")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask" })).toBeVisible();
});

test("personal prompt page allows editing preferences", async ({ page }) => {
  await page.goto("/prompts/me");
  await expect(page.getByRole("heading", { name: "Personal Prompt" })).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save prompt" })).toBeVisible();
});
```

- [ ] **Step 2: Run smoke tests to verify they fail**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium tests/smoke.spec.ts
```

Expected: FAIL because Q&A and prompt pages are not implemented.

- [ ] **Step 3: Implement Q&A and prompt pages**

Implement:

- `/qa`: question input, answer panel, status display, and citation list.
- `/prompts/system`: administrator page for current system prompt and version history.
- `/prompts/me`: standard-user page for personal prompt editing and enable/disable state.
- `CitationList`: document title, locator, and quoted preview.

- [ ] **Step 4: Run smoke tests**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium tests/smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-app/src/app/qa apps/web-app/src/app/prompts apps/web-app/src/components/CitationList.tsx apps/web-app/tests/smoke.spec.ts
git commit -m "feat: add qa and prompt screens"
```

## Task 10: End-To-End Acceptance And Documentation

**Files:**
- Create: `README.md`
- Modify: `apps/web-app/tests/smoke.spec.ts`
- Modify: `services/api/tests/test_document_review.py`
- Modify: `services/api/tests/test_rag_grounding.py`

- [ ] **Step 1: Add acceptance checklist to README**

Create `README.md` with:

```markdown
# Enterprise Knowledge QA

## MVP Acceptance Flow

1. Start PostgreSQL with `docker compose -f infra/docker-compose.yml up -d`.
2. Start the FastAPI backend from `services/api`.
3. Start the Next.js frontend from `apps/web-app`.
4. Sign in as administrator.
5. Create a product/module category.
6. Sign in as a standard user.
7. Upload a PDF, Word, PowerPoint, or Excel file.
8. Confirm the document is pending review.
9. Sign in as administrator.
10. Approve the document.
11. Confirm the document becomes indexed.
12. Ask a question whose answer exists in the document.
13. Confirm the answer includes citations.
14. Ask a question unsupported by the document.
15. Confirm the system refuses with insufficient evidence.
16. Update personal prompt style.
17. Confirm answer formatting changes while citations remain required.
18. Update system prompt as administrator.
19. Confirm new answers record the active system prompt version.
```

- [ ] **Step 2: Run backend test suite**

Run:

```bash
cd services/api
python -m pytest -q
```

Expected: PASS.

- [ ] **Step 3: Run frontend smoke tests**

Run:

```bash
cd apps/web-app
npm test -- --project=chromium
```

Expected: PASS.

- [ ] **Step 4: Run final git status check**

Run:

```bash
git status --short
```

Expected: only intended README or test updates are listed before the commit.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/web-app/tests/smoke.spec.ts services/api/tests/test_document_review.py services/api/tests/test_rag_grounding.py
git commit -m "test: document mvp acceptance flow"
```

## Execution Notes

- Use fake LLM and fake embeddings in automated tests.
- Keep indexing synchronous for the first runnable version.
- Keep file storage local under `services/api/storage/uploads`.
- Protect grounding and citation rules in application code, not only in editable prompt text.
- Do not introduce external system integrations in this implementation pass.
- Do not introduce department-level or tenant-level permission models in this implementation pass.

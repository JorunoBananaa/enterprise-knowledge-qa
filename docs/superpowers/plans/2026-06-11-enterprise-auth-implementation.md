# Enterprise Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MVP hardcoded/localStorage authentication with database-backed internal accounts, HttpOnly Cookie sessions, route protection, and minimum administrator user management.

**Architecture:** FastAPI owns authentication, authorization, password hashing, cookie issuance, and database user verification. Next.js no longer stores readable tokens; it uses `/auth/me` as the source of truth and sends cookies through `credentials: "include"`. User management is admin-only and uses the existing Ant Design UI stack.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, python-jose, passlib bcrypt, FastAPI TestClient, Next.js 14, React 18, TypeScript, Ant Design.

---

## Current Constraints

- The working tree currently has user edits in `web-app/src/app/login/page.tsx` and `web-app/src/components/AppShell.tsx` that make `/qa` the default destination. Preserve that behavior.
- Do not store new auth tokens in `localStorage`.
- Keep temporary backend bearer-token compatibility only for migration; frontend must use cookies only.
- There are no committed backend tests yet, so this plan creates the test harness.

## File Structure

### Backend Files

- Modify `services/api/app/models/user.py`: add `UserStatus`, `token_version`, explicit role/status enums.
- Modify `services/api/app/core/config.py`: add auth cookie and token expiry settings.
- Modify `services/api/app/core/security.py`: add password hashing, token creation/decoding with `token_version`, cookie helpers.
- Modify `services/api/app/schemas/auth.py`: add current-user/login/password-change schemas.
- Create `services/api/app/schemas/user.py`: user management request/response schemas.
- Create `services/api/app/repositories/users.py`: user lookup, create, update, password reset, last-admin guard helpers.
- Modify `services/api/app/api/deps.py`: read cookie token, load database user, return typed current user, enforce admin.
- Replace `services/api/app/api/routes/auth.py`: database-backed login/logout/me/password-change routes.
- Create `services/api/app/api/routes/users.py`: admin user management routes.
- Modify `services/api/app/main.py`: seed bcrypt users, register users router.
- Modify `services/api/app/api/routes/documents.py`: use `current_user.id`.
- Modify `services/api/app/api/routes/prompts.py`: use `current_user.id`.
- Modify `services/api/app/api/routes/qa.py`: store `str(current_user.id)` for session ownership.
- Modify `services/api/app/api/routes/llm_config.py`: require login for `/brief`.
- Create `services/api/tests/conftest.py`: isolated SQLite test database and helpers.
- Create `services/api/tests/test_auth.py`: auth and token invalidation tests.
- Create `services/api/tests/test_users.py`: user-management tests.
- Create `services/api/tests/test_identity_routes.py`: business-route identity and auth coverage tests.

### Frontend Files

- Create `web-app/src/lib/auth-client.ts`: login/logout/current-user API client.
- Modify `web-app/src/lib/api.ts`: use cookies, central 401 redirect, remove bearer token logic.
- Modify `web-app/src/lib/auth.ts`: remove token storage responsibility or reduce to compatibility-free route helpers.
- Modify `web-app/src/components/AppShell.tsx`: call `/auth/me`, guard routes, render role-aware menu, logout via backend.
- Modify `web-app/src/app/login/page.tsx`: use auth client, support safe `next`, default to `/qa`.
- Replace `web-app/src/app/users/page.tsx`: admin user-management UI.
- Modify pages that import `parseToken`, especially `web-app/src/app/prompts/page.tsx`: use server-derived current-user state or fetch `/auth/me`.

---

## Task 1: Backend Test Harness And Failing Auth Tests

**Files:**
- Create: `services/api/tests/conftest.py`
- Create: `services/api/tests/test_auth.py`
- Create: `services/api/tests/test_users.py`

- [ ] **Step 1: Create the test harness**

Create `services/api/tests/conftest.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.api.deps import get_db
from app.core.security import hash_password
from app.db.base import Base
from app.main import app
from app.models.user import User, UserRole, UserStatus


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    TestingSessionLocal = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        db.add(
            User(
                username="admin",
                display_name="Administrator",
                password_hash=hash_password("admin123"),
                role=UserRole.ADMIN,
                status=UserStatus.ACTIVE,
            )
        )
        db.add(
            User(
                username="user",
                display_name="Standard User",
                password_hash=hash_password("user123"),
                role=UserRole.STANDARD,
                status=UserStatus.ACTIVE,
            )
        )
        db.commit()
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def login(client: TestClient, username: str = "admin", password: str = "admin123"):
    return client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
```

- [ ] **Step 2: Add failing auth behavior tests**

Create `services/api/tests/test_auth.py`:

```python
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.user import User, UserStatus
from tests.conftest import login


def test_login_sets_httponly_cookie(client: TestClient):
    response = login(client)

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "admin"
    assert response.json()["user"]["role"] == "admin"
    set_cookie = response.headers["set-cookie"]
    assert "access_token=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie


def test_login_rejects_wrong_password(client: TestClient):
    response = login(client, password="bad-password")

    assert response.status_code == 401
    assert response.json()["detail"] == "用户名或密码错误"


def test_disabled_user_cannot_login(client: TestClient, db_session: Session):
    user = db_session.query(User).filter(User.username == "user").one()
    user.status = UserStatus.DISABLED
    db_session.commit()

    response = login(client, username="user", password="user123")

    assert response.status_code == 401
    assert response.json()["detail"] == "账号不可用"


def test_me_requires_session(client: TestClient):
    response = client.get("/auth/me")

    assert response.status_code == 401


def test_me_returns_current_user(client: TestClient):
    login(client)

    response = client.get("/auth/me")

    assert response.status_code == 200
    assert response.json()["username"] == "admin"
    assert response.json()["role"] == "admin"


def test_logout_clears_cookie(client: TestClient):
    login(client)

    response = client.post("/auth/logout")

    assert response.status_code == 200
    assert "access_token=" in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_password_change_invalidates_old_token(client: TestClient):
    login(client)
    old_cookie = client.cookies.get("access_token")

    response = client.patch(
        "/auth/me/password",
        json={"current_password": "admin123", "new_password": "new-admin123"},
    )

    assert response.status_code == 200
    client.cookies.set("access_token", old_cookie)
    assert client.get("/auth/me").status_code == 401


def test_bearer_fallback_works_when_cookie_missing(client: TestClient, db_session: Session):
    user = db_session.query(User).filter(User.username == "admin").one()
    token = create_access_token(user)

    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == "admin"
```

- [ ] **Step 3: Add failing user-management tests**

Create `services/api/tests/test_users.py`:

```python
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from tests.conftest import login


def test_standard_user_cannot_list_users(client: TestClient):
    login(client, username="user", password="user123")

    response = client.get("/users")

    assert response.status_code == 403


def test_admin_can_create_user(client: TestClient):
    login(client)

    response = client.post(
        "/users",
        json={
            "username": "alice",
            "display_name": "Alice",
            "password": "alice123",
            "role": "standard",
            "status": "active",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "alice"
    assert "password_hash" not in body


def test_duplicate_username_returns_conflict(client: TestClient):
    login(client)

    response = client.post(
        "/users",
        json={
            "username": "user",
            "display_name": "Duplicate",
            "password": "duplicate123",
            "role": "standard",
            "status": "active",
        },
    )

    assert response.status_code == 409


def test_admin_can_disable_user_and_invalidate_token(
    client: TestClient,
    db_session: Session,
):
    login(client, username="user", password="user123")
    old_cookie = client.cookies.get("access_token")
    client.cookies.clear()
    login(client)
    target = db_session.query(User).filter(User.username == "user").one()

    response = client.patch(f"/users/{target.id}", json={"status": "disabled"})

    assert response.status_code == 200
    client.cookies.set("access_token", old_cookie)
    assert client.get("/auth/me").status_code == 401


def test_admin_can_reset_password_and_invalidate_old_token(
    client: TestClient,
    db_session: Session,
):
    login(client, username="user", password="user123")
    old_cookie = client.cookies.get("access_token")
    client.cookies.clear()
    login(client)
    target = db_session.query(User).filter(User.username == "user").one()

    response = client.post(
        f"/users/{target.id}/reset-password",
        json={"new_password": "reset-user123"},
    )

    assert response.status_code == 200
    client.cookies.set("access_token", old_cookie)
    assert client.get("/auth/me").status_code == 401


def test_cannot_disable_last_active_admin(client: TestClient):
    login(client)

    response = client.patch("/users/1", json={"status": "disabled"})

    assert response.status_code == 400
    assert response.json()["detail"] == "不能禁用最后一个管理员"


def test_cannot_demote_last_active_admin(client: TestClient):
    login(client)

    response = client.patch("/users/1", json={"role": "standard"})

    assert response.status_code == 400
    assert response.json()["detail"] == "不能降级最后一个管理员"
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
cd services/api
python -m pytest tests/test_auth.py tests/test_users.py -q
```

Expected: FAIL because `hash_password`, database-backed auth, cookie auth, and `/users` routes do not exist yet.

- [ ] **Step 5: Commit failing tests**

```bash
git add services/api/tests/conftest.py services/api/tests/test_auth.py services/api/tests/test_users.py
git commit -m "test: add enterprise auth expectations"
```

---

## Task 2: Backend Auth Primitives And User Model

**Files:**
- Modify: `services/api/app/models/user.py`
- Modify: `services/api/app/core/config.py`
- Replace: `services/api/app/core/security.py`

- [ ] **Step 1: Update the user model**

Replace `services/api/app/models/user.py` with:

```python
import enum

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    STANDARD = "standard"


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(default=UserRole.STANDARD)
    status: Mapped[UserStatus] = mapped_column(default=UserStatus.ACTIVE)
    token_version: Mapped[int] = mapped_column(default=0)
```

- [ ] **Step 2: Add auth settings**

Replace `services/api/app/core/config.py` with:

```python
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
```

- [ ] **Step 3: Implement security helpers**

Replace `services/api/app/core/security.py` with:

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Response
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.value if hasattr(user.role, "value") else user.role,
        "token_version": user.token_version,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        sub = payload.get("sub")
        token_version = payload.get("token_version")
        if sub is None or token_version is None:
            raise ValueError("Invalid token claims")
        return payload
    except (JWTError, ValueError) as exc:
        raise ValueError("Invalid or expired token") from exc


def set_auth_cookie(response: Response, token: str) -> None:
    max_age = settings.access_token_expire_minutes * 60
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd services/api
python -m pytest tests/test_auth.py::test_login_sets_httponly_cookie -q
```

Expected: still FAIL because routes and dependencies have not been updated.

- [ ] **Step 5: Commit auth primitives**

```bash
git add services/api/app/models/user.py services/api/app/core/config.py services/api/app/core/security.py
git commit -m "feat: add auth security primitives"
```

---

## Task 3: Database-Backed Auth Routes And Dependencies

**Files:**
- Modify: `services/api/app/schemas/auth.py`
- Create: `services/api/app/repositories/users.py`
- Replace: `services/api/app/api/deps.py`
- Replace: `services/api/app/api/routes/auth.py`
- Modify: `services/api/app/main.py`

- [ ] **Step 1: Define auth schemas**

Replace `services/api/app/schemas/auth.py` with:

```python
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class CurrentUser(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    status: str


class LoginResponse(BaseModel):
    user: CurrentUser


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class MessageResponse(BaseModel):
    detail: str
```

- [ ] **Step 2: Add user repository helpers**

Create `services/api/app/repositories/users.py`:

```python
from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User, UserRole, UserStatus


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def list_users(
    db: Session,
    search: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[User], int]:
    query = db.query(User)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(User.username.ilike(pattern), User.display_name.ilike(pattern))
        )
    total = query.count()
    users = query.order_by(User.id.asc()).offset(offset).limit(limit).all()
    return users, total


def create_user(
    db: Session,
    username: str,
    display_name: str,
    password: str,
    role: UserRole = UserRole.STANDARD,
    status: UserStatus = UserStatus.ACTIVE,
) -> User:
    user = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        role=role,
        status=status,
        token_version=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def count_active_admins(db: Session) -> int:
    return (
        db.query(User)
        .filter(User.role == UserRole.ADMIN, User.status == UserStatus.ACTIVE)
        .count()
    )


def is_last_active_admin(db: Session, user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    status = user.status.value if hasattr(user.status, "value") else user.status
    return role == UserRole.ADMIN.value and status == UserStatus.ACTIVE.value and count_active_admins(db) <= 1


def bump_token_version(user: User) -> None:
    user.token_version = (user.token_version or 0) + 1
```

- [ ] **Step 3: Replace auth dependencies**

Replace `services/api/app/api/deps.py` with:

```python
from collections.abc import Generator
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User, UserRole, UserStatus
from app.repositories.users import get_user_by_id
from app.schemas.auth import CurrentUser


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user_to_current_user(user: User) -> CurrentUser:
    return CurrentUser(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role.value if hasattr(user.role, "value") else user.role,
        status=user.status.value if hasattr(user.status, "value") else user.status,
    )


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    access_token_cookie: Annotated[str | None, Cookie(alias=settings.auth_cookie_name)] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    token = access_token_cookie
    if token is None and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    try:
        claims = decode_access_token(token)
        user_id = int(claims["sub"])
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌无效或已过期",
        )

    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌无效或已过期",
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不可用")
    if user.token_version != claims.get("token_version"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌无效或已过期",
        )
    return _user_to_current_user(user)


def require_admin(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    if current_user.role != UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return current_user
```

- [ ] **Step 4: Replace auth routes**

Replace `services/api/app/api/routes/auth.py` with:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.security import (
    clear_auth_cookie,
    create_access_token,
    set_auth_cookie,
    hash_password,
    verify_password,
)
from app.models.user import UserStatus
from app.repositories.users import bump_token_version, get_user_by_id, get_user_by_username
from app.schemas.auth import (
    CurrentUser,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    PasswordChangeRequest,
)

router = APIRouter()


def _to_current_user(user) -> CurrentUser:
    return CurrentUser(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role.value if hasattr(user.role, "value") else user.role,
        status=user.status.value if hasattr(user.status, "value") else user.status,
    )


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> LoginResponse:
    user = get_user_by_username(db, payload.username)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不可用")

    token = create_access_token(user)
    set_auth_cookie(response, token)
    return LoginResponse(user=_to_current_user(user))


@router.post("/logout", response_model=MessageResponse)
def logout(response: Response) -> MessageResponse:
    clear_auth_cookie(response)
    return MessageResponse(detail="已退出登录")


@router.get("/me", response_model=CurrentUser)
def me(current_user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    return current_user


@router.patch("/me/password", response_model=MessageResponse)
def change_password(
    payload: PasswordChangeRequest,
    response: Response,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    user = get_user_by_id(db, current_user.id)
    if user is None or not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码错误")
    user.password_hash = hash_password(payload.new_password)
    bump_token_version(user)
    db.commit()
    clear_auth_cookie(response)
    return MessageResponse(detail="密码已更新，请重新登录")
```

- [ ] **Step 5: Update database seeding**

In `services/api/app/main.py`, import `hash_password` and seed real hashes. Replace the user seeding block with:

```python
        from app.core.security import hash_password
        from app.models.user import User, UserRole, UserStatus

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
```

- [ ] **Step 6: Run auth tests**

Run:

```bash
cd services/api
python -m pytest tests/test_auth.py -q
```

Expected: PASS for auth tests, except user-management tests still fail because `/users` is not implemented.

- [ ] **Step 7: Commit database-backed auth**

```bash
git add services/api/app/schemas/auth.py services/api/app/repositories/users.py services/api/app/api/deps.py services/api/app/api/routes/auth.py services/api/app/main.py
git commit -m "feat: add cookie backed database auth"
```

---

## Task 4: Admin User Management API

**Files:**
- Create: `services/api/app/schemas/user.py`
- Create: `services/api/app/api/routes/users.py`
- Modify: `services/api/app/main.py`

- [ ] **Step 1: Add user-management schemas**

Create `services/api/app/schemas/user.py`:

```python
from pydantic import BaseModel


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    status: str

    @classmethod
    def from_orm_obj(cls, user) -> "UserResponse":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role.value if hasattr(user.role, "value") else user.role,
            status=user.status.value if hasattr(user.status, "value") else user.status,
        )


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total: int


class UserCreate(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "standard"
    status: str = "active"


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = None
    status: str | None = None


class PasswordResetRequest(BaseModel):
    new_password: str
```

- [ ] **Step 2: Add user-management routes**

Create `services/api/app/api/routes/users.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.core.security import hash_password
from app.models.user import UserRole, UserStatus
from app.repositories.users import (
    bump_token_version,
    create_user,
    get_user_by_id,
    get_user_by_username,
    is_last_active_admin,
    list_users,
)
from app.schemas.auth import CurrentUser, MessageResponse
from app.schemas.user import (
    PasswordResetRequest,
    UserCreate,
    UserListResponse,
    UserResponse,
    UserUpdate,
)

router = APIRouter()


def _parse_role(value: str) -> UserRole:
    try:
        return UserRole(value)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色无效")


def _parse_status(value: str) -> UserStatus:
    try:
        return UserStatus(value)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="状态无效")


@router.get("", response_model=UserListResponse)
def get_users(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> UserListResponse:
    users, total = list_users(db, search=search, offset=offset, limit=limit)
    return UserListResponse(
        items=[UserResponse.from_orm_obj(user) for user in users],
        total=total,
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_route(
    payload: UserCreate,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    if get_user_by_username(db, payload.username) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")
    user = create_user(
        db,
        username=payload.username,
        display_name=payload.display_name,
        password=payload.password,
        role=_parse_role(payload.role),
        status=_parse_status(payload.status),
    )
    return UserResponse.from_orm_obj(user)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user_route(
    user_id: int,
    payload: UserUpdate,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    if payload.status == UserStatus.DISABLED.value and is_last_active_admin(db, user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能禁用最后一个管理员")
    if payload.role == UserRole.STANDARD.value and is_last_active_admin(db, user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能降级最后一个管理员")

    original_status = user.status
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.role is not None:
        user.role = _parse_role(payload.role)
    if payload.status is not None:
        user.status = _parse_status(payload.status)
    if original_status != user.status or user.status == UserStatus.DISABLED:
        bump_token_version(user)
    db.commit()
    db.refresh(user)
    return UserResponse.from_orm_obj(user)


@router.post("/{user_id}/reset-password", response_model=MessageResponse)
def reset_password_route(
    user_id: int,
    payload: PasswordResetRequest,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    user.password_hash = hash_password(payload.new_password)
    bump_token_version(user)
    db.commit()
    return MessageResponse(detail="密码已重置")
```

- [ ] **Step 3: Register the users router**

In `services/api/app/main.py`, add the import:

```python
from app.api.routes.users import router as users_router
```

Register it after auth:

```python
app.include_router(users_router, prefix="/users", tags=["users"])
```

- [ ] **Step 4: Run user-management tests**

Run:

```bash
cd services/api
python -m pytest tests/test_users.py -q
```

Expected: PASS.

- [ ] **Step 5: Run backend auth and user tests together**

Run:

```bash
cd services/api
python -m pytest tests/test_auth.py tests/test_users.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit user-management API**

```bash
git add services/api/app/schemas/user.py services/api/app/api/routes/users.py services/api/app/main.py
git commit -m "feat: add admin user management api"
```

---

## Task 5: Business Route Identity Cleanup

**Files:**
- Create: `services/api/tests/test_identity_routes.py`
- Modify: `services/api/app/api/routes/documents.py`
- Modify: `services/api/app/api/routes/prompts.py`
- Modify: `services/api/app/api/routes/qa.py`
- Modify: `services/api/app/api/routes/llm_config.py`

- [ ] **Step 1: Add failing identity-route tests**

Create `services/api/tests/test_identity_routes.py`:

```python
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.chat import ChatSession
from app.models.prompt import UserPrompt
from app.models.user import User
from tests.conftest import login


def test_personal_prompt_uses_current_database_user_id(
    client: TestClient,
    db_session: Session,
):
    login(client, username="user", password="user123")
    user = db_session.query(User).filter(User.username == "user").one()

    response = client.put(
        "/prompts/me",
        json={"content": "Use concise answers.", "enabled": True},
    )

    assert response.status_code == 200
    prompt = db_session.query(UserPrompt).filter(UserPrompt.user_id == user.id).one()
    assert prompt.content == "Use concise answers."


def test_chat_session_uses_current_database_user_id(
    client: TestClient,
    db_session: Session,
):
    login(client, username="user", password="user123")
    user = db_session.query(User).filter(User.username == "user").one()

    response = client.post("/qa/sessions", json={"title": "My session"})

    assert response.status_code == 200
    session = db_session.query(ChatSession).one()
    assert session.user_id == str(user.id)


def test_llm_brief_requires_login(client: TestClient):
    response = client.get("/llm-configs/brief")

    assert response.status_code == 401
```

- [ ] **Step 2: Update document upload identity**

In `services/api/app/api/routes/documents.py`, replace:

```python
    # Determine uploader_id from hardcoded MVP users
    uploader_id = 1 if current_user["sub"] == "admin" else 2
```

with:

```python
    uploader_id = current_user.id
```

Also update the type annotation from `dict[str, str]` to `CurrentUser` and import `CurrentUser` from `app.schemas.auth`.

- [ ] **Step 3: Update prompt identity**

In `services/api/app/api/routes/prompts.py`, import `CurrentUser` and replace both occurrences of:

```python
    user_id = 1 if current_user["sub"] == "admin" else 2
```

with:

```python
    user_id = current_user.id
```

For system prompt creation, replace:

```python
    author_id = 1  # admin is user ID 1 in MVP
```

with:

```python
    author_id = admin.id
```

- [ ] **Step 4: Update QA session ownership**

In `services/api/app/api/routes/qa.py`, import `CurrentUser` and replace each:

```python
    user_id: str = current_user["sub"]
```

with:

```python
    user_id = str(current_user.id)
```

Update type annotations for `current_user` to `CurrentUser`.

- [ ] **Step 5: Require auth for LLM config brief**

In `services/api/app/api/routes/llm_config.py`, import `get_current_user` and `CurrentUser`. Change `list_configs_brief` from:

```python
@router.get("/brief", response_model=list[LLMConfigBrief])
def list_configs_brief() -> list[LLMConfigBrief]:
```

to:

```python
@router.get("/brief", response_model=list[LLMConfigBrief])
def list_configs_brief(
    _current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[LLMConfigBrief]:
```

- [ ] **Step 6: Run identity-route tests**

Run:

```bash
cd services/api
python -m pytest tests/test_identity_routes.py -q
```

Expected: PASS.

- [ ] **Step 7: Run all backend tests**

Run:

```bash
cd services/api
python -m pytest -q
```

Expected: PASS.

- [ ] **Step 8: Commit route identity cleanup**

```bash
git add services/api/tests/test_identity_routes.py services/api/app/api/routes/documents.py services/api/app/api/routes/prompts.py services/api/app/api/routes/qa.py services/api/app/api/routes/llm_config.py
git commit -m "fix: use database user identity in protected routes"
```

---

## Task 6: Frontend Cookie Auth Client And API Wrapper

**Files:**
- Create: `web-app/src/lib/auth-client.ts`
- Replace: `web-app/src/lib/api.ts`
- Modify: `web-app/src/lib/auth.ts`

- [ ] **Step 1: Create the frontend auth client**

Create `web-app/src/lib/auth-client.ts`:

```typescript
export interface CurrentUser {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "standard";
  status: "active" | "disabled";
}

interface LoginResponse {
  user: CurrentUser;
}

const API_BASE = "/api";

async function parseError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  return new Error(body.detail || "请求失败");
}

export async function login(
  username: string,
  password: string,
): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as LoginResponse;
  return data.user;
}

export async function logout(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export function buildLoginUrl(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export function isSafeNext(value: string | null): value is string {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}
```

- [ ] **Step 2: Replace the API wrapper**

Replace `web-app/src/lib/api.ts` with:

```typescript
import { buildLoginUrl } from "./auth-client";

const API_BASE = "/api";

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  window.location.href = buildLoginUrl(currentPath());
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (res.status === 401) {
    redirectToLogin();
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "请求失败");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}
```

- [ ] **Step 3: Remove token helpers from auth decisions**

Replace `web-app/src/lib/auth.ts` with a compatibility-free re-export file:

```typescript
export type { CurrentUser } from "./auth-client";
export {
  buildLoginUrl,
  getCurrentUser,
  isSafeNext,
  login,
  logout,
} from "./auth-client";
```

- [ ] **Step 4: Check for stale token imports**

Run:

```bash
cd web-app
rg -n "getToken|setToken|clearToken|parseToken|isLoggedIn|access_token|Authorization" src
```

Expected: references remain in `AppShell.tsx`, `login/page.tsx`, and `prompts/page.tsx` until later frontend tasks. No new localStorage references are added.

- [ ] **Step 5: Commit frontend auth client**

```bash
git add web-app/src/lib/auth-client.ts web-app/src/lib/api.ts web-app/src/lib/auth.ts
git commit -m "feat: add cookie based frontend auth client"
```

---

## Task 7: Frontend AppShell And Login Migration

**Files:**
- Replace: `web-app/src/components/AppShell.tsx`
- Replace: `web-app/src/app/login/page.tsx`
- Modify: `web-app/src/app/prompts/page.tsx`

- [ ] **Step 1: Replace AppShell auth flow**

Replace `web-app/src/components/AppShell.tsx` with a version that:

```typescript
// Required imports:
// useEffect, useMemo, useState from react
// Link from next/link
// usePathname, useRouter, useSearchParams from next/navigation
// Layout, Menu, Button, Space, Typography, App, Spin from antd
// existing icons
// CurrentUser, buildLoginUrl, getCurrentUser, isSafeNext, logout from "@/lib/auth-client"

// Required behavior:
// - public path set: new Set(["/login"])
// - on pathname change, call getCurrentUser()
// - if authenticated and on /login, redirect to safe next or /qa
// - if unauthenticated and protected path, redirect to /login?next=<path>
// - if unauthenticated and public path, render children
// - while checking protected path, render centered <Spin />
// - handleLogout calls logout(), clears user state, router.push("/login")
// - selectedKey default remains "/qa"
// - brand link remains "/qa"
// - admin-only menu items remain role-gated by user?.role === "admin"
```

Use this central state shape:

```typescript
const [user, setUser] = useState<CurrentUser | null>(null);
const [checking, setChecking] = useState(true);
```

Use this redirect helper inside the component:

```typescript
const currentFullPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
```

- [ ] **Step 2: Replace login page token handling**

In `web-app/src/app/login/page.tsx`:

- Replace `setToken` import with `login` and `isSafeNext` from `@/lib/auth-client`.
- Use `useSearchParams`.
- On submit, call `await login(values.username, values.password)`.
- Redirect to safe `next` or `/qa`.

The submit handler should become:

```typescript
const searchParams = useSearchParams();

const handleSubmit = async (values: {
  username: string;
  password: string;
}) => {
  setError("");
  setLoading(true);

  try {
    await login(values.username, values.password);
    const next = searchParams.get("next");
    router.push(isSafeNext(next) ? next : "/qa");
  } catch (err) {
    setError(err instanceof Error ? err.message : "登录失败");
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 3: Remove token parsing from prompts page**

In `web-app/src/app/prompts/page.tsx`, replace `parseToken` usage with `getCurrentUser`.

Use state:

```typescript
const [role, setRole] = useState<"admin" | "standard" | null>(null);

useEffect(() => {
  getCurrentUser()
    .then((currentUser) => setRole(currentUser.role))
    .catch(() => setRole(null));
}, []);

const isAdmin = role === "admin";
```

While `role === null`, render a simple loading container rather than rendering admin tabs.

- [ ] **Step 4: Check stale auth references**

Run:

```bash
cd web-app
rg -n "getToken|setToken|clearToken|parseToken|isLoggedIn|access_token|Authorization" src
```

Expected: no matches.

- [ ] **Step 5: Build frontend**

Run:

```bash
cd web-app
pnpm build
```

Expected: PASS. If `pnpm` is not installed, run `npm run build` and record that fallback in the final summary.

- [ ] **Step 6: Commit frontend auth migration**

```bash
git add web-app/src/components/AppShell.tsx web-app/src/app/login/page.tsx web-app/src/app/prompts/page.tsx
git commit -m "feat: migrate frontend to cookie auth"
```

---

## Task 8: Frontend User Management Page

**Files:**
- Replace: `web-app/src/app/users/page.tsx`

- [ ] **Step 1: Replace the existing users page**

Replace `web-app/src/app/users/page.tsx` with an Ant Design client component that includes:

- `UserRecord` type matching backend response.
- `fetchUsers(search?: string)` using `apiFetch<UserListResponse>("/users?...")`.
- Table columns for username, display name, role tag, status tag.
- Search input.
- Create-user modal with username, display name, password, role, status.
- Edit modal for display name, role, status.
- Reset-password modal.
- Calls:
  - `GET /users`
  - `POST /users`
  - `PATCH /users/{id}`
  - `POST /users/{id}/reset-password`

Use these API types:

```typescript
interface UserRecord {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "standard";
  status: "active" | "disabled";
}

interface UserListResponse {
  items: UserRecord[];
  total: number;
}
```

Use role/status labels:

```typescript
const roleLabels = { admin: "管理员", standard: "普通用户" };
const statusLabels = { active: "启用", disabled: "禁用" };
```

- [ ] **Step 2: Ensure action buttons are explicit**

Each row should expose:

- Edit button with `EditOutlined`.
- Reset password button with `KeyOutlined`.

Use Ant Design `Modal`, `Form`, `Input`, `Select`, `Table`, `Tag`, `Button`, and `Space`. Keep the page functional and dense; avoid nested cards.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd web-app
pnpm build
```

Expected: PASS. If `pnpm` is not installed, use `npm run build`.

- [ ] **Step 4: Commit user-management UI**

```bash
git add web-app/src/app/users/page.tsx
git commit -m "feat: add user management page"
```

---

## Task 9: Final Verification And Cleanup

**Files:**
- Inspect: all modified backend and frontend files.
- Modify: only files required to fix verification failures.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd services/api
python -m pytest -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend stale-token scan**

Run:

```bash
cd web-app
rg -n "localStorage|access_token|getToken|setToken|clearToken|parseToken|isLoggedIn|Authorization" src
```

Expected: no matches related to auth token storage or bearer headers.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd web-app
pnpm build
```

Expected: PASS. If `pnpm` is not available, run:

```bash
cd web-app
npm run build
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: no uncommitted implementation changes after the final verification commit. If the original user edits remain because they were superseded in committed files, explain that in the final summary.

- [ ] **Step 5: Commit verification fixes**

If Step 1, 2, or 3 required fixes, commit them:

```bash
git add <changed-files>
git commit -m "fix: complete enterprise auth verification"
```

If no fixes were needed, do not create an empty commit.

---

## Implementation Order

1. Task 1 creates failing backend tests.
2. Task 2 adds auth primitives.
3. Task 3 makes login/logout/me/password-change work.
4. Task 4 adds admin user management APIs.
5. Task 5 removes hardcoded identity from business routes.
6. Task 6 adds frontend cookie auth primitives.
7. Task 7 migrates shell and login flow.
8. Task 8 builds user-management UI.
9. Task 9 verifies the full stack.

This order keeps each backend slice testable before frontend migration and avoids mixing UI work with auth correctness.

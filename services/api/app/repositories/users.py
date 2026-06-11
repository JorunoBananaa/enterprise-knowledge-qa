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

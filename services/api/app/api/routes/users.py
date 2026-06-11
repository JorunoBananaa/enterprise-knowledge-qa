from __future__ import annotations

from typing import Annotated, Optional

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
    search: Optional[str] = Query(None),
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

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

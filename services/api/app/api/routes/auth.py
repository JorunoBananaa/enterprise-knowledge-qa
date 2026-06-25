from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import _user_to_current_user, get_current_user, get_db
from app.core.security import (
    clear_auth_cookie,
    create_access_token,
    set_auth_cookie,
    verify_password,
)
from app.models.user import UserStatus
from app.repositories.users import get_user_by_username
from app.schemas.auth import (
    CurrentUser,
    LoginRequest,
    LoginResponse,
    MessageResponse,
)

router = APIRouter()


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
    return LoginResponse(user=_user_to_current_user(user))


@router.post("/logout", response_model=MessageResponse)
def logout(response: Response) -> MessageResponse:
    clear_auth_cookie(response)
    return MessageResponse(detail="已退出登录")


@router.get("/me", response_model=CurrentUser)
def me(current_user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    return current_user




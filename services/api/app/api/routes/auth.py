from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.security import create_access_token
from app.schemas.auth import LoginRequest, TokenResponse

router = APIRouter()

# Hardcoded credentials for MVP
_MVP_USERS = {
    "admin": {"password": "a", "role": "admin"},
    "user": {"password": "a", "role": "standard"},
}


@router.post("/login")
def login(payload: LoginRequest) -> TokenResponse:
    """Accept admin/a or user/a for the MVP."""
    user = _MVP_USERS.get(payload.username)
    if user is None or user["password"] != payload.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    token = create_access_token(subject=payload.username, role=user["role"])
    return TokenResponse(access_token=token)


@router.get("/me")
def me(current_user: Annotated[dict[str, str], Depends(get_current_user)]) -> dict[str, str]:
    """Return the current token subject and role."""
    return {"username": current_user["sub"], "role": current_user["role"]}

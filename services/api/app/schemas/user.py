from __future__ import annotations

from typing import Optional

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
    display_name: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None


class PasswordResetRequest(BaseModel):
    new_password: str

from typing import Any

from pydantic import BaseModel


class SystemPromptCreate(BaseModel):
    content: str


class SystemPromptResponse(BaseModel):
    id: int
    version: int
    content: str
    status: str
    author_id: int

    @classmethod
    def from_orm_obj(cls, obj: Any) -> "SystemPromptResponse":
        return cls(
            id=obj.id,
            version=obj.version,
            content=obj.content,
            status=obj.status.value if hasattr(obj.status, "value") else obj.status,
            author_id=obj.author_id,
        )


class UserPromptUpdate(BaseModel):
    content: str
    enabled: bool = True


class UserPromptResponse(BaseModel):
    id: int
    user_id: int
    content: str
    enabled: bool
    version: int

    @classmethod
    def from_orm_obj(cls, obj: Any) -> "UserPromptResponse":
        return cls(
            id=obj.id,
            user_id=obj.user_id,
            content=obj.content,
            enabled=obj.enabled,
            version=obj.version,
        )

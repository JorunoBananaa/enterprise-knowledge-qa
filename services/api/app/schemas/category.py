from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class CategoryResponse(BaseModel):
    id: int
    name: str
    parent_id: int | None = None
    documents_count: int = 0

    @classmethod
    def from_orm_obj(cls, obj: Any, documents_count: int = 0) -> "CategoryResponse":
        return cls(
            id=obj.id,
            name=obj.name,
            parent_id=obj.parent_id,
            documents_count=documents_count,
        )


class CategoryListResponse(BaseModel):
    items: list[CategoryResponse]


class CategoryCreate(BaseModel):
    name: str
    parent_id: int | None = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None

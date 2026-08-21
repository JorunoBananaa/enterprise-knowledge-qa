from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: int
    title: str
    file_type: str
    uploader_id: int
    category_id: int
    review_status: str
    index_status: str
    failure_reason: str | None = None

    @classmethod
    def from_orm_obj(cls, obj: Any) -> "DocumentResponse":
        return cls(
            id=obj.id,
            title=obj.title,
            file_type=obj.file_type,
            uploader_id=obj.uploader_id,
            category_id=obj.category_id,
            review_status=obj.review_status.value if hasattr(obj.review_status, "value") else obj.review_status,
            index_status=obj.index_status,
            failure_reason=obj.failure_reason,
        )


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    total: int


class DocumentUploadResponse(BaseModel):
    items: list[DocumentResponse]

from __future__ import annotations
from typing import Optional

import enum

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocumentReviewStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class DocumentIndexStatus(str, enum.Enum):
    NOT_INDEXED = "not_indexed"
    INDEXING = "indexing"
    INDEXED = "indexed"
    FAILED = "failed"


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(32))
    storage_path: Mapped[str] = mapped_column(Text)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("knowledge_categories.id"))
    review_status: Mapped[DocumentReviewStatus] = mapped_column(insert_default=DocumentReviewStatus.PENDING_REVIEW, default=DocumentReviewStatus.PENDING_REVIEW)
    index_status: Mapped[str] = mapped_column(String(32), insert_default=DocumentIndexStatus.NOT_INDEXED.value, default=DocumentIndexStatus.NOT_INDEXED.value)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __init__(self, **kwargs: object) -> None:
        kwargs.setdefault("review_status", DocumentReviewStatus.PENDING_REVIEW)
        kwargs.setdefault("index_status", DocumentIndexStatus.NOT_INDEXED.value)
        super().__init__(**kwargs)

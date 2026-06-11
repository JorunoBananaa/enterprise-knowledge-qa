from __future__ import annotations

from typing import Any

from app.db.session import SessionLocal
from app.models.document import KnowledgeDocument


def get_document_by_id(document_id: int) -> KnowledgeDocument | None:
    db = SessionLocal()
    try:
        return db.query(KnowledgeDocument).filter(KnowledgeDocument.id == document_id).first()
    finally:
        db.close()


def create_document(data: dict[str, Any]) -> KnowledgeDocument:
    db = SessionLocal()
    try:
        doc = KnowledgeDocument(**data)
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return doc
    finally:
        db.close()


def update_document(document_id: int, **kwargs: Any) -> KnowledgeDocument | None:
    db = SessionLocal()
    try:
        doc = db.query(KnowledgeDocument).filter(KnowledgeDocument.id == document_id).first()
        if doc is None:
            return None
        for key, value in kwargs.items():
            setattr(doc, key, value)
        db.commit()
        db.refresh(doc)
        return doc
    finally:
        db.close()


def list_documents(
    category_id: int | None = None,
    review_status: str | None = None,
    uploader_id: int | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[KnowledgeDocument], int]:
    db = SessionLocal()
    try:
        query = db.query(KnowledgeDocument)
        if category_id is not None:
            query = query.filter(KnowledgeDocument.category_id == category_id)
        if review_status is not None:
            query = query.filter(KnowledgeDocument.review_status == review_status)
        if uploader_id is not None:
            query = query.filter(KnowledgeDocument.uploader_id == uploader_id)
        total = query.count()
        items = query.order_by(KnowledgeDocument.id.desc()).offset(offset).limit(limit).all()
        return items, total
    finally:
        db.close()

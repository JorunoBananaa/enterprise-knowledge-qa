from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.category import KnowledgeCategory


def list_categories(db: Session) -> list[KnowledgeCategory]:
    return db.query(KnowledgeCategory).order_by(KnowledgeCategory.id.asc()).all()


def get_category_by_id(db: Session, category_id: int) -> KnowledgeCategory | None:
    return db.query(KnowledgeCategory).filter(KnowledgeCategory.id == category_id).first()


def get_category_by_name(db: Session, name: str) -> KnowledgeCategory | None:
    return db.query(KnowledgeCategory).filter(KnowledgeCategory.name == name).first()


def create_category(
    db: Session,
    name: str,
    parent_id: int | None = None,
) -> KnowledgeCategory:
    cat = KnowledgeCategory(name=name, parent_id=parent_id)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def update_category(
    db: Session,
    cat: KnowledgeCategory,
    name: str | None = None,
    parent_id: int | None = None,
) -> KnowledgeCategory:
    if name is not None:
        cat.name = name
    if parent_id is not None:
        cat.parent_id = parent_id
    db.commit()
    db.refresh(cat)
    return cat


def delete_category(db: Session, cat: KnowledgeCategory) -> None:
    db.delete(cat)
    db.commit()


def count_documents_in_category(db: Session, category_id: int) -> int:
    from app.models.document import KnowledgeDocument

    return (
        db.query(KnowledgeDocument)
        .filter(KnowledgeDocument.category_id == category_id)
        .count()
    )

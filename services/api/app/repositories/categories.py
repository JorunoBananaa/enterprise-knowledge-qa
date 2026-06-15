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


def get_descendant_category_ids(db: Session, category_id: int) -> list[int]:
    """递归获取所有子孙分类 ID（不包括自身）。"""
    result: list[int] = []
    children = (
        db.query(KnowledgeCategory)
        .filter(KnowledgeCategory.parent_id == category_id)
        .all()
    )
    for child in children:
        result.append(child.id)
        result.extend(get_descendant_category_ids(db, child.id))
    return result


def delete_category(db: Session, cat: KnowledgeCategory) -> None:
    """删除分类，同时级联删除所有子分类及其下的全部文档。"""
    from app.models.document import KnowledgeDocument

    descendant_ids = get_descendant_category_ids(db, cat.id)
    all_category_ids = [cat.id] + descendant_ids

    # 1) 删除这些分类下的所有文档（chunk 由 DB 级联 ondelete=CASCADE 自动清理）
    docs = (
        db.query(KnowledgeDocument)
        .filter(KnowledgeDocument.category_id.in_(all_category_ids))
        .all()
    )
    for doc in docs:
        # 先删磁盘文件，再删数据库记录
        from app.services.storage import delete_upload
        delete_upload(doc.storage_path)
        db.delete(doc)
    db.flush()  # 确保文档 FK 已解除，再删除分类

    # 2) 从底层向上逐层删除子分类，每次立即 flush 以确保
    #    自引用外键按正确顺序解除（子节点先于父节点删除）
    for child_id in reversed(descendant_ids):
        child = (
            db.query(KnowledgeCategory).filter(KnowledgeCategory.id == child_id).first()
        )
        if child is not None:
            db.delete(child)
            db.flush()

    # 3) 删除当前分类
    db.delete(cat)
    db.commit()


def count_documents_in_category(db: Session, category_id: int) -> int:
    """统计该分类及所有子孙分类下的文档总数。"""
    from app.models.document import KnowledgeDocument

    all_ids = [category_id] + get_descendant_category_ids(db, category_id)
    return (
        db.query(KnowledgeDocument)
        .filter(KnowledgeDocument.category_id.in_(all_ids))
        .count()
    )

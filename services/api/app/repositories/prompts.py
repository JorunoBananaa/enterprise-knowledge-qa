from __future__ import annotations

from app.db.session import SessionLocal
from app.models.prompt import PromptStatus, PromptTemplate, UserPrompt


def get_active_system_prompt() -> PromptTemplate | None:
    db = SessionLocal()
    try:
        return (
            db.query(PromptTemplate)
            .filter(PromptTemplate.status == PromptStatus.ACTIVE)
            .order_by(PromptTemplate.version.desc())
            .first()
        )
    finally:
        db.close()


def create_system_prompt(content: str, author_id: int) -> PromptTemplate:
    db = SessionLocal()
    try:
        latest = (
            db.query(PromptTemplate)
            .order_by(PromptTemplate.version.desc())
            .first()
        )
        next_version = (latest.version + 1) if latest else 1
        pt = PromptTemplate(
            version=next_version,
            content=content,
            status=PromptStatus.DRAFT,
            author_id=author_id,
        )
        db.add(pt)
        db.commit()
        db.refresh(pt)
        return pt
    finally:
        db.close()


def activate_prompt(version: int) -> PromptTemplate | None:
    db = SessionLocal()
    try:
        # Deactivate all
        db.query(PromptTemplate).filter(PromptTemplate.status == PromptStatus.ACTIVE).update(
            {"status": PromptStatus.ARCHIVED}
        )
        # Activate target
        pt = (
            db.query(PromptTemplate)
            .filter(PromptTemplate.version == version)
            .first()
        )
        if pt is None:
            db.rollback()
            return None
        pt.status = PromptStatus.ACTIVE
        db.commit()
        db.refresh(pt)
        return pt
    finally:
        db.close()


def list_system_prompts() -> list[PromptTemplate]:
    db = SessionLocal()
    try:
        return db.query(PromptTemplate).order_by(PromptTemplate.version.desc()).all()
    finally:
        db.close()


def get_user_prompt(user_id: int) -> UserPrompt | None:
    db = SessionLocal()
    try:
        return db.query(UserPrompt).filter(UserPrompt.user_id == user_id).first()
    finally:
        db.close()


def upsert_user_prompt(user_id: int, content: str, enabled: bool) -> UserPrompt:
    db = SessionLocal()
    try:
        up = db.query(UserPrompt).filter(UserPrompt.user_id == user_id).first()
        if up is None:
            up = UserPrompt(user_id=user_id, content=content, enabled=enabled, version=1)
            db.add(up)
        else:
            up.content = content
            up.enabled = enabled
            up.version += 1
        db.commit()
        db.refresh(up)
        return up
    finally:
        db.close()

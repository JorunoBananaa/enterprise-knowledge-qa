from __future__ import annotations

from app.db.session import SessionLocal
from app.models.prompt import UserPrompt


def get_system_prompt_content() -> str:
    """Return the active system prompt content, or empty string."""
    db = SessionLocal()
    try:
        from app.models.prompt import PromptStatus, PromptTemplate

        pt = (
            db.query(PromptTemplate)
            .filter(PromptTemplate.status == PromptStatus.ACTIVE)
            .order_by(PromptTemplate.version.desc())
            .first()
        )
        return pt.content if pt else ""
    finally:
        db.close()


def upsert_system_prompt(content: str, author_id: int) -> None:
    """Set the system prompt content. Deactivates old, creates new active."""
    from app.models.prompt import PromptStatus, PromptTemplate

    db = SessionLocal()
    try:
        # Deactivate all
        db.query(PromptTemplate).filter(
            PromptTemplate.status == PromptStatus.ACTIVE
        ).update({"status": PromptStatus.ARCHIVED})
        # Get next version
        latest = (
            db.query(PromptTemplate)
            .order_by(PromptTemplate.version.desc())
            .first()
        )
        next_version = (latest.version + 1) if latest else 1
        pt = PromptTemplate(
            version=next_version,
            content=content,
            status=PromptStatus.ACTIVE,
            author_id=author_id,
        )
        db.add(pt)
        db.commit()
    finally:
        db.close()


def get_user_prompt(user_id: int) -> str:
    """Return the user's personal prompt content, or empty string."""
    db = SessionLocal()
    try:
        up = db.query(UserPrompt).filter(UserPrompt.user_id == user_id).first()
        return up.content if up else ""
    finally:
        db.close()


def upsert_user_prompt(user_id: int, content: str) -> None:
    """Create or update the user's personal prompt."""
    db = SessionLocal()
    try:
        up = db.query(UserPrompt).filter(UserPrompt.user_id == user_id).first()
        if up is None:
            up = UserPrompt(user_id=user_id, content=content)
            db.add(up)
        else:
            up.content = content
        db.commit()
    finally:
        db.close()

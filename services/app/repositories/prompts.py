from __future__ import annotations

from app.db.session import SessionLocal
from app.models.prompt import UserPrompt


def get_system_prompt_content() -> str:
    """返回活跃的系统提示词内容；没有则返回空字符串。"""
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
    """设置系统提示词内容；停用旧版本并创建新的活跃版本。"""
    from app.models.prompt import PromptStatus, PromptTemplate

    db = SessionLocal()
    try:
        # 停用全部旧版本
        db.query(PromptTemplate).filter(
            PromptTemplate.status == PromptStatus.ACTIVE
        ).update({"status": PromptStatus.ARCHIVED})
        # 获取下一个版本号
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
    """返回用户的个人提示词内容；没有则返回空字符串。"""
    db = SessionLocal()
    try:
        up = db.query(UserPrompt).filter(UserPrompt.user_id == user_id).first()
        return up.content if up else ""
    finally:
        db.close()


def upsert_user_prompt(user_id: int, content: str) -> None:
    """创建或更新用户的个人提示词。"""
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

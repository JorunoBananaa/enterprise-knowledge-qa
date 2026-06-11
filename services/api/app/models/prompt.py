import enum

from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PromptStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(index=True)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[PromptStatus] = mapped_column(default=PromptStatus.DRAFT)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class UserPrompt(Base):
    __tablename__ = "user_prompts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    content: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(default=True)
    version: Mapped[int] = mapped_column(default=1)

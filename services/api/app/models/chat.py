from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.document import KnowledgeDocument


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    result_status: Mapped[str] = mapped_column(default="answered")
    system_prompt_version: Mapped[Optional[int]] = mapped_column(nullable=True)
    user_prompt_version: Mapped[Optional[int]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    citations: Mapped[list["Citation"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id", ondelete="CASCADE"))
    document_id: Mapped[int] = mapped_column(ForeignKey("knowledge_documents.id"))
    chunk_id: Mapped[int]
    locator: Mapped[str] = mapped_column(Text)
    quoted_text_preview: Mapped[str] = mapped_column(Text)
    rank: Mapped[int] = mapped_column(default=1)

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LLMConfig(Base):
    """LLM provider configuration – supports DeepSeek, OpenAI, and future providers."""

    __tablename__ = "llm_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, comment="Display name, e.g. 'DeepSeek Production'")
    provider: Mapped[str] = mapped_column(
        String(64), index=True, comment="Provider key: deepseek, openai, anthropic, etc."
    )
    model_name: Mapped[str] = mapped_column(String(256), comment="e.g. deepseek-chat, gpt-4o")
    api_key: Mapped[str] = mapped_column(Text, comment="Encrypted or plain-text API key")
    base_url: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True, comment="Override API base URL, e.g. https://api.deepseek.com/v1"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, comment="Only one config should be active at a time")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

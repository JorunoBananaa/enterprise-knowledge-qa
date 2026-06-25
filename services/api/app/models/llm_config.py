from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LLMConfig(Base):
    """LLM 提供商配置 —— 支持 DeepSeek、OpenAI 及未来的提供商。"""

    __tablename__ = "llm_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, comment="展示名称，如 'DeepSeek 生产环境'")
    provider: Mapped[str] = mapped_column(
        String(64), index=True, comment="提供商键：deepseek、openai、anthropic 等"
    )
    model_name: Mapped[str] = mapped_column(String(256), comment="如 deepseek-chat、gpt-4o")
    api_key: Mapped[str] = mapped_column(Text, comment="加密或明文 API key")
    base_url: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True, comment="覆盖 API base URL，如 https://api.deepseek.com/v1"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, comment="同一时间只应有一个活跃配置")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

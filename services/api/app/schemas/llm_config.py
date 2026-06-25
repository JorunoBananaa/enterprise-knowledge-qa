from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class LLMConfigCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    provider: str = Field(..., min_length=1, max_length=64)
    model_name: str = Field(..., min_length=1, max_length=256)
    api_key: str = Field(..., min_length=1)
    base_url: str | None = Field(None, max_length=512)


class LLMConfigUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    provider: str | None = Field(None, min_length=1, max_length=64)
    model_name: str | None = Field(None, min_length=1, max_length=256)
    api_key: str | None = Field(None, min_length=1)
    base_url: str | None = Field(None, max_length=512)
    is_active: bool | None = None


class LLMConfigResponse(BaseModel):
    id: int
    name: str
    provider: str
    model_name: str
    api_key: str  # 响应中已脱敏
    base_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_obj(cls, obj: Any) -> "LLMConfigResponse":
        # 脱敏 API key —— 仅显示最后 4 位
        key = obj.api_key or ""
        masked = "****" + key[-4:] if len(key) > 4 else "****"
        return cls(
            id=obj.id,
            name=obj.name,
            provider=obj.provider,
            model_name=obj.model_name,
            api_key=masked,
            base_url=obj.base_url,
            is_active=obj.is_active,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


class LLMConfigBrief(BaseModel):
    """下拉选择的轻量选项。"""
    id: int
    name: str
    provider: str
    model_name: str
    is_active: bool

    @classmethod
    def from_orm_obj(cls, obj: Any) -> "LLMConfigBrief":
        return cls(
            id=obj.id,
            name=obj.name,
            provider=obj.provider,
            model_name=obj.model_name,
            is_active=obj.is_active,
        )

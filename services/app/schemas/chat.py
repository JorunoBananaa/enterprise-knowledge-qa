from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


# ── 问答（QA） ──────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    session_id: int | None = None  # None → 创建新会话
    llm_config_id: int | None = None  # None → 使用活跃配置
    category_ids: list[int] | None = None  # None / [] → 搜索所有分类
    document_ids: list[int] | None = None  # None / [] → 搜索所有文档
    request_id: str | None = None
    edit_message_id: int | None = None  # 编辑模式：截断该消息及其后续消息后重新生成


class AskCancelRequest(BaseModel):
    request_id: str


# ── 会话列表 / 详情 ─────────────────────────────────────────────

class CitationOut(BaseModel):
    id: int | None = None
    document_id: int | None = None
    document_title: str | None = None
    document_name: str | None = None
    document_file_type: str | None = None
    document_path: str | None = None
    document_category_id: int | None = None
    chunk_id: int
    locator: str
    quoted_text_preview: str | None = None
    rank: int | None = None

    model_config = {"from_attributes": True}


class ChatMessageOut(BaseModel):
    id: int
    question: str
    answer: str
    result_status: str
    created_at: datetime
    citations: list[CitationOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ChatSessionOut(BaseModel):
    id: int
    title: str | None
    created_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ChatSessionDetail(ChatSessionOut):
    messages: list[ChatMessageOut] = []


class ForkSessionResponse(BaseModel):
    session_id: int

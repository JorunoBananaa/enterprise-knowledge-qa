from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


# ── Ask (QA) ──────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    session_id: int | None = None  # None → create a new session
    llm_config_id: int | None = None  # None → use active config
    category_ids: list[int] | None = None  # None / [] → search all categories
    document_ids: list[int] | None = None  # None / [] → search all documents
    request_id: str | None = None


class AskCancelRequest(BaseModel):
    request_id: str


# ── Session list / detail ─────────────────────────────────────────────

class CitationOut(BaseModel):
    id: int | None = None
    document_id: int
    document_title: str | None = None
    document_name: str | None = None
    document_file_type: str | None = None
    document_storage_path: str | None = None
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

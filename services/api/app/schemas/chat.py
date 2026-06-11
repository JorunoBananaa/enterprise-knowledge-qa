from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


# ── Ask (QA) ──────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    session_id: int | None = None  # None → create a new session
    llm_config_id: int | None = None  # None → use active config; -1 → fake mode


class CitationItem(BaseModel):
    document_id: int
    chunk_id: int
    locator: str
    quoted_text_preview: str | None = None


class AskResponse(BaseModel):
    session_id: int
    message_id: int
    status: str
    answer: str
    citations: list[CitationItem]


# ── Session list / detail ─────────────────────────────────────────────

class ChatMessageOut(BaseModel):
    id: int
    question: str
    answer: str
    result_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionOut(BaseModel):
    id: int
    title: str | None
    created_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ChatSessionDetail(ChatSessionOut):
    messages: list[ChatMessageOut] = []


class CreateSessionRequest(BaseModel):
    title: str | None = None


class CreateSessionResponse(BaseModel):
    id: int
    title: str | None = None

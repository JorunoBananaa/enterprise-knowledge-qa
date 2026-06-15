from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


# ── Ask (QA) ──────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    session_id: int | None = None  # None → create a new session
    llm_config_id: int | None = None  # None → use active config
    category_ids: list[int] | None = None  # None / [] → search all categories
    document_ids: list[int] | None = None  # None / [] → search all documents


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

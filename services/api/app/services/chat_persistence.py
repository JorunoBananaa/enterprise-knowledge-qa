from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import func

from app.models.chat import ChatMessage, ChatSession, Citation


def _first_line(text: str, max_len: int = 60) -> str:
    """提取文本首行作为标题，超出 max_len 则截断并加省略号。"""
    line = text.split("\n", 1)[0].strip()
    if len(line) <= max_len:
        return line
    return line[: max_len - 1] + "…"


def is_new_session(
    db: Any,
    *,
    session: ChatSession,
) -> bool:
    """Return True when the session has no metadata name and no messages yet.

    A session is considered "new" only if both conditions hold:
    - Its title is empty (None or blank string).
    - Its message queue is empty.
    """
    if session.title:
        return False

    message_count = (
        db.query(func.count(ChatMessage.id))
        .filter(ChatMessage.session_id == session.id)
        .scalar()
    )
    return message_count == 0


def persist_new_chat_session(
    db: Any,
    *,
    user_id: str,
    title: str | None,
) -> ChatSession:
    session = ChatSession(
        user_id=user_id,
        title=title,
    )
    db.add(session)
    db.flush()
    db.commit()
    return session


def update_session_title_for_first_question(
    db: Any,
    *,
    session: ChatSession,
    question: str,
) -> None:
    if not is_new_session(db, session=session):
        return

    session.title = _first_line(question)
    db.add(session)
    db.commit()


def persist_streamed_chat_message(
    db: Any,
    *,
    session_id: int,
    question: str,
    answer_parts: Sequence[str],
    result_status: str,
    citations: Sequence[Mapping[str, Any]],
) -> ChatMessage:
    answer = "".join(answer_parts)
    msg = ChatMessage(
        session_id=session_id,
        question=question,
        answer=answer,
        result_status=result_status,
    )
    db.add(msg)
    db.flush()

    for citation in citations:
        db.add(
            Citation(
                chat_message_id=msg.id,
                document_id=citation.get("document_id", 0),
                chunk_id=citation.get("chunk_id", 0),
                locator=citation.get("locator", ""),
                quoted_text_preview=citation.get("quoted_text_preview", ""),
                rank=citation.get("rank", 0),
            )
        )

    db.commit()
    return msg

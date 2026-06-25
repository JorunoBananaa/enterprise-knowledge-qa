from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import func

from app.models.chat import ChatMessage, ChatSession, Citation


def _first_line(text: str, max_len: int = 60) -> str:
    line = text.split("\n")[0].strip()
    return line[:max_len] + ("…" if len(line) > max_len else "")


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
    if session.title != "新会话":
        return

    message_count = (
        db.query(func.count(ChatMessage.id))
        .filter(ChatMessage.session_id == session.id)
        .scalar()
    )
    if message_count:
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

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.models.chat import ChatMessage, Citation


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

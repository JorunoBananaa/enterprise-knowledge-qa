from __future__ import annotations

from collections import defaultdict
from typing import DefaultDict

from sqlalchemy.orm import Session

from app.models.chat import ChatMessage, ChatSession, Citation


class ChatBranchTargetNotFound(Exception):
    """当请求的分支目标对该用户不可用时抛出。"""


class ChatSessionVersionConflict(Exception):
    """会话已被其他编辑请求推进版本时抛出。"""


def reserve_chat_session_edit(
    db: Session,
    *,
    session_id: int,
    user_id: str,
    expected_version: int,
) -> None:
    updated = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
            ChatSession.visibility == "active",
            ChatSession.version == expected_version,
        )
        .update(
            {ChatSession.version: ChatSession.version + 1},
            synchronize_session=False,
        )
    )
    if updated != 1:
        db.commit()
        raise ChatSessionVersionConflict()
    db.commit()


def fork_chat_session_at_message(
    db: Session,
    *,
    user_id: str,
    message_id: int,
) -> ChatSession:
    target_message = (
        db.query(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(ChatMessage.id == message_id, ChatSession.user_id == user_id)
        .first()
    )
    if target_message is None:
        raise ChatBranchTargetNotFound()

    source_session = (
        db.query(ChatSession)
        .filter(ChatSession.id == target_message.session_id, ChatSession.user_id == user_id)
        .first()
    )
    if source_session is None:
        raise ChatBranchTargetNotFound()

    ordered_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == source_session.id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        .all()
    )
    source_messages: list[ChatMessage] = []
    for message in ordered_messages:
        source_messages.append(message)
        if message.id == target_message.id:
            break

    if not source_messages or source_messages[-1].id != target_message.id:
        raise ChatBranchTargetNotFound()

    source_message_ids = [message.id for message in source_messages]
    citation_rows = (
        db.query(Citation)
        .filter(Citation.chat_message_id.in_(source_message_ids))
        .order_by(Citation.chat_message_id.asc(), Citation.rank.asc(), Citation.id.asc())
        .all()
    )
    citations_by_message_id: DefaultDict[int, list[Citation]] = defaultdict(list)
    for citation in citation_rows:
        citations_by_message_id[citation.chat_message_id].append(citation)

    try:
        new_session = ChatSession(
            user_id=user_id,
            title=source_session.title,
            parent_session_id=source_session.id,
            branch_from_message_id=target_message.id,
            visibility="active",
        )
        db.add(new_session)
        db.flush()

        for source_message in source_messages:
            new_message = ChatMessage(
                session_id=new_session.id,
                question=source_message.question,
                answer=source_message.answer,
                result_status=source_message.result_status,
                created_at=source_message.created_at,
            )
            db.add(new_message)
            db.flush()

            for source_citation in citations_by_message_id[source_message.id]:
                db.add(
                    Citation(
                        chat_message_id=new_message.id,
                        document_id=source_citation.document_id,
                        chunk_id=source_citation.chunk_id,
                        locator=source_citation.locator,
                        quoted_text_preview=source_citation.quoted_text_preview,
                        rank=source_citation.rank,
                    )
                )

        db.commit()
        return new_session
    except Exception:
        db.rollback()
        raise


def fork_chat_session_before_message(
    db: Session,
    *,
    user_id: str,
    message_id: int,
) -> ChatSession:
    """复制目标消息之前的历史，供非破坏性编辑生成新分支。"""
    target_message = (
        db.query(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(ChatMessage.id == message_id, ChatSession.user_id == user_id)
        .first()
    )
    if target_message is None:
        raise ChatBranchTargetNotFound()

    source_session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == target_message.session_id,
            ChatSession.user_id == user_id,
        )
        .first()
    )
    if source_session is None:
        raise ChatBranchTargetNotFound()

    ordered_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == source_session.id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        .all()
    )
    source_messages: list[ChatMessage] = []
    target_found = False
    for message in ordered_messages:
        if message.id == target_message.id:
            target_found = True
            break
        source_messages.append(message)
    if not target_found:
        raise ChatBranchTargetNotFound()

    source_message_ids = [message.id for message in source_messages]
    citation_rows = (
        db.query(Citation)
        .filter(Citation.chat_message_id.in_(source_message_ids))
        .order_by(Citation.chat_message_id.asc(), Citation.rank.asc(), Citation.id.asc())
        .all()
        if source_message_ids
        else []
    )
    citations_by_message_id: DefaultDict[int, list[Citation]] = defaultdict(list)
    for citation in citation_rows:
        citations_by_message_id[citation.chat_message_id].append(citation)

    try:
        new_session = ChatSession(
            user_id=user_id,
            title=source_session.title,
            parent_session_id=source_session.id,
            branch_from_message_id=target_message.id,
            visibility="provisional",
        )
        db.add(new_session)
        db.flush()

        for source_message in source_messages:
            new_message = ChatMessage(
                session_id=new_session.id,
                question=source_message.question,
                answer=source_message.answer,
                result_status=source_message.result_status,
                created_at=source_message.created_at,
            )
            db.add(new_message)
            db.flush()

            for source_citation in citations_by_message_id[source_message.id]:
                db.add(
                    Citation(
                        chat_message_id=new_message.id,
                        document_id=source_citation.document_id,
                        chunk_id=source_citation.chunk_id,
                        locator=source_citation.locator,
                        quoted_text_preview=source_citation.quoted_text_preview,
                        rank=source_citation.rank,
                    )
                )

        db.commit()
        return new_session
    except Exception:
        db.rollback()
        raise


def discard_chat_session(db: Session, *, session_id: int, user_id: str) -> None:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if session is None:
        return
    db.delete(session)
    db.commit()


def activate_chat_session(db: Session, *, session_id: int, user_id: str) -> None:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if session is None:
        raise ChatBranchTargetNotFound()
    session.visibility = "active"
    db.add(session)
    db.commit()

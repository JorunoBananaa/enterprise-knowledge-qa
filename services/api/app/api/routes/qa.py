from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.models.chat import ChatMessage, ChatSession, Citation
from app.models.document import KnowledgeDocument
from app.models.category import KnowledgeCategory
from app.models.document_chunk import DocumentChunk
from app.repositories.llm_config import get_active_llm_config, get_llm_config
from app.repositories.prompts import get_system_prompt_content, get_user_prompt
from app.schemas.auth import CurrentUser
from app.schemas.chat import (
    AskCancelRequest,
    AskRequest,
    CitationOut,
    ChatMessageOut,
    ChatSessionDetail,
    ChatSessionOut,
    ForkSessionResponse,
)
from app.services.embedding_factory import create_embeddings
from app.services.chat_branching import (
    ChatBranchTargetNotFound,
    fork_chat_session_at_message,
)
from app.services.chat_persistence import (
    _first_line,
    persist_new_chat_session,
    persist_streamed_chat_message,
    update_session_title_for_first_question,
)
from app.services.llm_factory import create_chat_model
from app.services.rag import answer_question_stream, rewrite_question_for_retrieval

router = APIRouter()

CHAT_HISTORY_LIMIT = 6
SSE_HEADERS = {
    "X-Accel-Buffering": "no",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
}


@dataclass
class AskCancelState:
    event: asyncio.Event
    task: asyncio.Task[Any] | None = None


_ASK_CANCEL_STATES: dict[str, AskCancelState] = {}


# ── 工具函数 ───────────────────────────────────────────────────────────


def format_sse(event_type: str, data: dict | str | None = None) -> str:
    """格式化 Server-Sent Event 字符串。"""
    if data is None:
        data = {}
    payload = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else data
    return f"event: {event_type}\ndata: {payload}\n\n"


def _register_ask_cancel_state(request_id: str | None) -> AskCancelState | None:
    if not request_id:
        return None

    state = _ASK_CANCEL_STATES.get(request_id)
    if state is None:
        state = AskCancelState(event=asyncio.Event())
        _ASK_CANCEL_STATES[request_id] = state

    state.task = asyncio.current_task()
    return state


def _refresh_ask_cancel_task(state: AskCancelState | None) -> None:
    if state is not None:
        state.task = asyncio.current_task()


def _unregister_ask_cancel_state(
    request_id: str | None,
    state: AskCancelState | None,
) -> None:
    if request_id and _ASK_CANCEL_STATES.get(request_id) is state:
        _ASK_CANCEL_STATES.pop(request_id, None)


def _is_ask_cancelled(state: AskCancelState | None) -> bool:
    return bool(state and state.event.is_set())


def _resolve_session(
    user_id: str,
    session_id: int | None,
    question: str,
    db: Session,
) -> ChatSession:
    """Resolve or create a chat session."""
    if session_id is not None:
        session = (
            db.query(ChatSession)
            .filter(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
            )
            .first()
        )
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        update_session_title_for_first_question(
            db,
            session=session,
            question=question,
        )
        return session

    return persist_new_chat_session(
        db,
        user_id=user_id,
        title=_first_line(question),
    )


def _resolve_llm(llm_config_id: int | None) -> Any:
    """Resolve LLM from config; raises if no valid LLM is configured."""
    if llm_config_id is not None and llm_config_id > 0:
        cfg = get_llm_config(llm_config_id)
        if cfg is None:
            raise HTTPException(status_code=404, detail="大模型配置不存在")
        try:
            return create_chat_model(
                provider=cfg.provider,
                model_name=cfg.model_name,
                api_key=cfg.api_key,
                base_url=cfg.base_url,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"无法初始化大模型: {exc}")

    # llm_config_id is None → use active config
    active = get_active_llm_config()
    if active is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="没有活跃的大模型配置，请先在 LLM 配置页面设置一个活跃的模型",
        )
    try:
        return create_chat_model(
            provider=active.provider,
            model_name=active.model_name,
            api_key=active.api_key,
            base_url=active.base_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法初始化大模型: {exc}")


def _resolve_prompts(user_id: int) -> tuple[str | None, str | None]:
    """Resolve configured system prompt and user answer preferences."""
    system_prompt = get_system_prompt_content().strip() or None
    user_prompt = get_user_prompt(user_id).strip() or None
    return system_prompt, user_prompt


def _load_chat_history(
    session_id: int,
    db: Session,
    limit: int = CHAT_HISTORY_LIMIT,
) -> list[dict[str, str]]:
    """Load recent session turns in chronological order."""
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {"question": row.question, "answer": row.answer}
        for row in reversed(rows)
    ]


def _truncate_session_from_message(
    db: Session,
    *,
    session_id: int,
    edit_message_id: int,
) -> None:
    """Delete the target message and all subsequent messages in the session.

    Used by the edit-question flow: the edited question and its answer (and
    every message after it) are removed so a fresh answer can be regenerated.
    """
    target = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.id == edit_message_id,
            ChatMessage.session_id == session_id,
        )
        .first()
    )
    if target is None:
        raise HTTPException(status_code=404, detail="编辑的消息不存在")

    # Select messages at or after the target (by created_at, then id)
    messages_to_delete = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .filter(
            (ChatMessage.created_at > target.created_at)
            | (
                (ChatMessage.created_at == target.created_at)
                & (ChatMessage.id >= target.id)
            )
        )
        .all()
    )
    message_ids = [m.id for m in messages_to_delete]
    if message_ids:
        db.query(Citation).filter(
            Citation.chat_message_id.in_(message_ids)
        ).delete(synchronize_session=False)
        db.query(ChatMessage).filter(
            ChatMessage.id.in_(message_ids)
        ).delete(synchronize_session=False)
        db.commit()


def _resolve_category_tree(db: Session, category_ids: list[int]) -> list[int]:
    """Given a list of category IDs, return all IDs including descendants."""
    all_cats = db.query(KnowledgeCategory).all()
    children_map: dict[int, list[int]] = {}
    for c in all_cats:
        if c.parent_id is not None:
            children_map.setdefault(c.parent_id, []).append(c.id)

    result: set[int] = set()
    stack = list(category_ids)
    while stack:
        cid = stack.pop()
        if cid in result:
            continue
        result.add(cid)
        stack.extend(children_map.get(cid, []))
    return list(result)


def _build_category_path_map(db: Session) -> dict[int, str]:
    """Build display paths for all knowledge categories."""
    categories = db.query(KnowledgeCategory).all()
    category_by_id = {category.id: category for category in categories}

    def build_path(category_id: int) -> str:
        names: list[str] = []
        seen: set[int] = set()
        current = category_by_id.get(category_id)
        while current is not None and current.id not in seen:
            seen.add(current.id)
            names.append(current.name)
            current = (
                category_by_id.get(current.parent_id)
                if current.parent_id is not None
                else None
            )
        return " / ".join(reversed(names))

    return {
        category_id: path
        for category_id in category_by_id
        if (path := build_path(category_id))
    }


def _resolve_target_document_ids(
    db: Session,
    category_ids: list[int] | None,
    document_ids: list[int] | None,
) -> list[int] | None:
    """Resolve the set of document IDs for retrieval filtering.

    Returns None if no filtering is needed (search all documents).
    """
    has_filter = bool(category_ids) or bool(document_ids)
    if not has_filter:
        return None

    target_ids: set[int] = set()

    if category_ids:
        all_category_ids = _resolve_category_tree(db, category_ids)
        doc_ids_from_cats = (
            db.query(KnowledgeDocument.id)
            .filter(KnowledgeDocument.category_id.in_(all_category_ids))
            .all()
        )
        target_ids.update(row[0] for row in doc_ids_from_cats)

    if document_ids:
        target_ids.update(document_ids)

    return list(target_ids)


def _compute_query_embedding(question: str) -> list[float]:
    """Compute the query embedding (synchronous, may load model weights)."""
    provider = settings.embedding_provider

    if provider in ("huggingface", "ollama"):
        kwargs: dict[str, str] = {}
        if provider == "ollama":
            kwargs["base_url"] = settings.ollama_base_url
        embed_model = create_embeddings(
            provider=provider,
            model_name=settings.embedding_model_name,
            **kwargs,
        )
    else:
        # Remote providers need an active LLM config for the API key
        active_cfg = get_active_llm_config()
        if active_cfg is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="没有活跃的大模型配置，无法执行向量检索",
            )
        embed_model = create_embeddings(
            provider=active_cfg.provider,
            model_name=settings.embedding_model_name,
            api_key=active_cfg.api_key,
            base_url=active_cfg.base_url,
        )

    return embed_model.embed_query(question)


async def _retrieve_chunks(
    question: str,
    db: Session,
    top_k: int = 5,
    target_document_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Retrieve the most relevant document chunks via pgvector ANN search.

    Generates an embedding for the question, then performs cosine similarity
    search against the document_chunks table.

    When `target_document_ids` is provided, only chunks belonging to those
    documents are considered.

    The embedding computation runs in a worker thread so that a slow model
    load / inference does not block the event loop (which would starve
    concurrent requests such as POST /sessions).
    """
    if target_document_ids == []:
        return []

    query_embedding = await asyncio.to_thread(_compute_query_embedding, question)

    query = db.query(DocumentChunk, KnowledgeDocument).join(
        KnowledgeDocument,
        KnowledgeDocument.id == DocumentChunk.document_id,
    )
    if target_document_ids is not None:
        query = query.filter(DocumentChunk.document_id.in_(target_document_ids))

    rows = (
        query
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
        .all()
    )
    if not rows:
        return []

    category_paths = _build_category_path_map(db)
    return [
        {
            "chunk_id": chunk.id,
            "document_id": chunk.document_id,
            "document_title": document.title,
            "document_name": document.title,
            "document_file_type": document.file_type,
            "document_storage_path": document.storage_path,
            "document_path": category_paths.get(document.category_id),
            "document_category_id": document.category_id,
            "locator": chunk.locator,
            "text": chunk.text,
        }
        for chunk, document in rows
    ]


# ── Sessions ──────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ChatSessionOut]:
    """List all sessions belonging to the current user (newest first)."""
    user_id = str(current_user.id)
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at.desc())
        .all()
    )
    out: list[ChatSessionOut] = []
    for s in sessions:
        msg_count = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == s.id)
            .count()
        )
        out.append(
            ChatSessionOut(
                id=s.id,
                title=s.title,
                created_at=s.created_at,
                message_count=msg_count,
            )
        )
    return out


@router.post("/sessions", response_model=ChatSessionOut)
def create_session(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionOut:
    """Create an empty chat session for starting a new conversation."""
    session = persist_new_chat_session(
        db,
        user_id=str(current_user.id),
        title="新会话",
    )
    return ChatSessionOut(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        message_count=0,
    )


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(
    session_id: int,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionDetail:
    """Get a single session with all its messages."""
    user_id = str(current_user.id)
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    citation_map: dict[int, list[CitationOut]] = {}
    message_ids = [m.id for m in messages]
    if message_ids:
        citation_rows = (
            db.query(Citation, KnowledgeDocument)
            .outerjoin(
                KnowledgeDocument,
                KnowledgeDocument.id == Citation.document_id,
            )
            .filter(Citation.chat_message_id.in_(message_ids))
            .order_by(
                Citation.chat_message_id.asc(),
                Citation.rank.asc(),
                Citation.id.asc(),
            )
            .all()
        )
        category_paths = _build_category_path_map(db) if citation_rows else {}

        for citation, document in citation_rows:
            citation_map.setdefault(citation.chat_message_id, []).append(
                CitationOut(
                    id=citation.id,
                    document_id=citation.document_id,
                    document_title=document.title if document else None,
                    document_name=document.title if document else None,
                    document_file_type=document.file_type if document else None,
                    document_storage_path=document.storage_path if document else None,
                    document_path=(
                        category_paths.get(document.category_id) if document else None
                    ),
                    document_category_id=document.category_id if document else None,
                    chunk_id=citation.chunk_id,
                    locator=citation.locator,
                    quoted_text_preview=citation.quoted_text_preview,
                    rank=citation.rank,
                )
            )

    return ChatSessionDetail(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        message_count=len(messages),
        messages=[
            ChatMessageOut(
                id=m.id,
                question=m.question,
                answer=m.answer,
                result_status=m.result_status,
                created_at=m.created_at,
                citations=citation_map.get(m.id, []),
            )
            for m in messages
        ],
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: int,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a session and all its messages."""
    user_id = str(current_user.id)
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # Delete citations then messages (citations FK to messages)
    message_ids = [
        m.id
        for m in db.query(ChatMessage.id)
        .filter(ChatMessage.session_id == session_id)
        .all()
    ]
    if message_ids:
        db.query(Citation).filter(Citation.chat_message_id.in_(message_ids)).delete()
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()

    db.delete(session)
    db.commit()


@router.post("/messages/{message_id}/fork", response_model=ForkSessionResponse)
def fork_message(
    message_id: int,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ForkSessionResponse:
    """Fork a chat session at a completed message."""
    try:
        new_session = fork_chat_session_at_message(
            db,
            user_id=str(current_user.id),
            message_id=message_id,
        )
    except ChatBranchTargetNotFound:
        raise HTTPException(status_code=404, detail="消息不存在")

    return ForkSessionResponse(session_id=new_session.id)


# ── Ask (streaming) ───────────────────────────────────────────────────


@router.post("/ask/cancel")
async def cancel_question_stream(
    payload: AskCancelRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, bool]:
    """Cancel an in-flight streaming answer for the current process."""
    del current_user

    state = _ASK_CANCEL_STATES.get(payload.request_id)
    if state is None:
        return {"cancelled": False}

    state.event.set()
    if state.task is not None:
        state.task.cancel()

    return {"cancelled": True}


@router.post("/ask/stream")
async def ask_question_stream(
    payload: AskRequest,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Ask a question with SSE streaming response.

    Events:
        session → {"session_id": …}
        chunk   → {"text": "…"}
        citation → {"document_id": …, "document_name": …, "document_path": …, "chunk_id": …, "locator": …}
        done    → {"status": "answered", "session_id": …, "message_id": …}
        error   → {"message": "…"}
    """
    user_id = str(current_user.id)
    cancel_state = _register_ask_cancel_state(payload.request_id)
    session: ChatSession | None = None
    pre_stream_abort_persisted = False

    async def _should_stop() -> bool:
        if _is_ask_cancelled(cancel_state):
            return True
        return await request.is_disconnected()

    def _persist_pre_stream_abort() -> None:
        nonlocal pre_stream_abort_persisted
        if session is None or pre_stream_abort_persisted:
            return

        persist_streamed_chat_message(
            db,
            session_id=session.id,
            question=payload.question,
            answer_parts=[],
            result_status="aborted",
            citations=[],
        )
        pre_stream_abort_persisted = True

    def _empty_stream_response() -> StreamingResponse:
        return StreamingResponse(
            iter(()),
            media_type="text/event-stream",
            headers=SSE_HEADERS,
        )

    try:
        session = _resolve_session(user_id, payload.session_id, payload.question, db)

        # 编辑模式：截断目标消息及其后续消息，然后重新生成
        if payload.edit_message_id is not None:
            _truncate_session_from_message(
                db,
                session_id=session.id,
                edit_message_id=payload.edit_message_id,
            )

        if await _should_stop():
            _persist_pre_stream_abort()
            _unregister_ask_cancel_state(payload.request_id, cancel_state)
            return _empty_stream_response()

        # Build LLM synchronously
        try:
            llm = _resolve_llm(payload.llm_config_id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"无法初始化大模型: {exc}")

        if await _should_stop():
            _persist_pre_stream_abort()
            _unregister_ask_cancel_state(payload.request_id, cancel_state)
            return _empty_stream_response()

        # Resolve scope filtering (categories → document IDs)
        target_document_ids = _resolve_target_document_ids(
            db, payload.category_ids, payload.document_ids,
        )

        system_prompt, user_prompt = _resolve_prompts(current_user.id)
        chat_history = _load_chat_history(session.id, db)
        retrieval_question = await rewrite_question_for_retrieval(
            question=payload.question,
            chat_history=chat_history,
            llm=llm,
        )

        if await _should_stop():
            _persist_pre_stream_abort()
            _unregister_ask_cancel_state(payload.request_id, cancel_state)
            return _empty_stream_response()

        # Retrieve relevant chunks via pgvector ANN search (scoped)
        retrieved_chunks = await _retrieve_chunks(
            retrieval_question, db, target_document_ids=target_document_ids,
        )

        if await _should_stop():
            _persist_pre_stream_abort()
            _unregister_ask_cancel_state(payload.request_id, cancel_state)
            return _empty_stream_response()
    except asyncio.CancelledError:
        _persist_pre_stream_abort()
        _unregister_ask_cancel_state(payload.request_id, cancel_state)
        raise
    except Exception:
        _unregister_ask_cancel_state(payload.request_id, cancel_state)
        raise

    async def _stream_events():
        chunks_received: list[str] = []
        citation_list: list[dict] = []
        persisted_msg: ChatMessage | None = None

        def persist_message(result_status: str) -> ChatMessage:
            nonlocal persisted_msg
            if persisted_msg is not None:
                return persisted_msg

            persisted_msg = persist_streamed_chat_message(
                db,
                session_id=session.id,
                question=payload.question,
                answer_parts=chunks_received,
                result_status=result_status,
                citations=citation_list,
            )
            return persisted_msg

        try:
            _refresh_ask_cancel_task(cancel_state)

            if await _should_stop():
                persist_message("aborted")
                return

            yield format_sse("session", {"session_id": session.id})

            async for event in answer_question_stream(
                question=payload.question,
                retrieved_chunks=retrieved_chunks,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                llm=llm,
                chat_history=chat_history,
            ):
                if await _should_stop():
                    persist_message("aborted")
                    return

                if event["type"] == "chunk":
                    chunks_received.append(event["text"])
                    yield format_sse("chunk", {"text": event["text"]})

                elif event["type"] == "citation":
                    citation_list.append(event)
                    yield format_sse("citation", event)

                elif event["type"] == "done":
                    msg = persist_message(event.get("status", "answered"))

                    yield format_sse("done", {
                        "status": event.get("status", "answered"),
                        "session_id": session.id,
                        "message_id": msg.id,
                    })
                    return

                elif event["type"] == "error":
                    yield format_sse("error", {"message": event["message"]})
                    return

        except asyncio.CancelledError:
            persist_message("aborted")
            raise
        except Exception as exc:
            logging.getLogger(__name__).exception("Stream error")
            yield format_sse("error", {"message": f"流式生成失败: {exc}"})
        finally:
            _unregister_ask_cancel_state(payload.request_id, cancel_state)

    return StreamingResponse(
        _stream_events(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )

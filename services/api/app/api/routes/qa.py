from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
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
    AskRequest,
    ChatMessageOut,
    ChatSessionDetail,
    ChatSessionOut,
)
from app.services.embedding_factory import create_embeddings
from app.services.llm_factory import create_chat_model
from app.services.rag import answer_question_stream, rewrite_question_for_retrieval

router = APIRouter()

DEFAULT_SYSTEM_PROMPT = "请根据公司知识库回答。回答应简洁有用。"
CHAT_HISTORY_LIMIT = 6


# ── Helpers ───────────────────────────────────────────────────────────

def _first_line(text: str, max_len: int = 60) -> str:
    """Extract first line of text as a title fallback."""
    line = text.split("\n")[0].strip()
    return line[:max_len] + ("…" if len(line) > max_len else "")


def format_sse(event_type: str, data: dict | str | None = None) -> str:
    """Format a Server-Sent Event string."""
    if data is None:
        data = {}
    payload = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else data
    return f"event: {event_type}\ndata: {payload}\n\n"


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
        return session

    session = ChatSession(
        user_id=user_id,
        title=_first_line(question),
    )
    db.add(session)
    db.flush()
    return session


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


def _resolve_prompts(user_id: int) -> tuple[str, str | None]:
    """Resolve configured system prompt and user answer preferences."""
    system_prompt = get_system_prompt_content().strip() or DEFAULT_SYSTEM_PROMPT
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


def _retrieve_chunks(
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
    """
    if target_document_ids == []:
        return []

    provider = settings.embedding_provider

    if provider == "huggingface":
        embed_model = create_embeddings(
            provider="huggingface",
            model_name=settings.embedding_model_name,
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

    query_embedding = embed_model.embed_query(question)

    query = db.query(DocumentChunk)
    if target_document_ids is not None:
        query = query.filter(DocumentChunk.document_id.in_(target_document_ids))

    chunks = (
        query
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
        .all()
    )

    return [
        {
            "chunk_id": chunk.id,
            "document_id": chunk.document_id,
            "locator": chunk.locator,
            "text": chunk.text,
        }
        for chunk in chunks
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
    return ChatSessionDetail(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        message_count=len(messages),
        messages=[
            ChatMessageOut.model_validate(m) for m in messages
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


# ── Ask (streaming) ───────────────────────────────────────────────────

@router.post("/ask/stream")
async def ask_question_stream(
    payload: AskRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Ask a question with SSE streaming response.

    Events:
        chunk   → {"text": "…"}
        citation → {"document_id": …, "chunk_id": …, "locator": …}
        done    → {"status": "answered", "session_id": …, "message_id": …}
        error   → {"message": "…"}
    """
    user_id = str(current_user.id)

    session = _resolve_session(user_id, payload.session_id, payload.question, db)

    # Build LLM synchronously
    try:
        llm = _resolve_llm(payload.llm_config_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法初始化大模型: {exc}")

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

    # Retrieve relevant chunks via pgvector ANN search (scoped)
    retrieved_chunks = _retrieve_chunks(
        retrieval_question, db, target_document_ids=target_document_ids,
    )

    async def _stream_events():
        chunks_received: list[str] = []
        citation_list: list[dict] = []

        try:
            async for event in answer_question_stream(
                question=payload.question,
                retrieved_chunks=retrieved_chunks,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                llm=llm,
                chat_history=chat_history,
            ):
                if event["type"] == "chunk":
                    chunks_received.append(event["text"])
                    yield format_sse("chunk", {"text": event["text"]})

                elif event["type"] == "citation":
                    citation_list.append(event)
                    yield format_sse("citation", event)

                elif event["type"] == "done":
                    # Persist message + citations on "done"
                    full_answer = "".join(chunks_received)
                    msg = ChatMessage(
                        session_id=session.id,
                        question=payload.question,
                        answer=full_answer,
                        result_status=event.get("status", "answered"),
                    )
                    db.add(msg)
                    db.flush()

                    for c in citation_list:
                        db.add(
                            Citation(
                                chat_message_id=msg.id,
                                document_id=c.get("document_id", 0),
                                chunk_id=c.get("chunk_id", 0),
                                locator=c.get("locator", ""),
                                quoted_text_preview=c.get("quoted_text_preview", ""),
                                rank=c.get("rank", 0),
                            )
                        )

                    db.commit()

                    yield format_sse("done", {
                        "status": event.get("status", "answered"),
                        "session_id": session.id,
                        "message_id": msg.id,
                    })
                    return

                elif event["type"] == "error":
                    yield format_sse("error", {"message": event["message"]})
                    return

        except Exception as exc:
            logging.getLogger(__name__).exception("Stream error")
            yield format_sse("error", {"message": f"流式生成失败: {exc}"})

    return StreamingResponse(
        _stream_events(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        },
    )

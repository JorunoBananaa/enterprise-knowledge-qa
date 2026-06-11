from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.chat import ChatMessage, ChatSession, Citation
from app.repositories.llm_config import get_active_llm_config, get_llm_config
from app.schemas.chat import (
    AskRequest,
    AskResponse,
    ChatMessageOut,
    ChatSessionDetail,
    ChatSessionOut,
    CitationItem,
    CreateSessionRequest,
    CreateSessionResponse,
)
from app.services.llm_factory import create_chat_model
from app.services.rag import answer_question

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────

def _first_line(text: str, max_len: int = 60) -> str:
    """Extract first line of text as a title fallback."""
    line = text.split("\n")[0].strip()
    return line[:max_len] + ("…" if len(line) > max_len else "")


# ── Sessions ──────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ChatSessionOut]:
    """List all sessions belonging to the current user (newest first)."""
    user_id: str = current_user["sub"]
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


@router.post("/sessions", response_model=CreateSessionResponse)
def create_session(
    payload: CreateSessionRequest,
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CreateSessionResponse:
    """Create a new empty chat session."""
    user_id: str = current_user["sub"]
    session = ChatSession(user_id=user_id, title=payload.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return CreateSessionResponse(id=session.id, title=session.title)


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(
    session_id: int,
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionDetail:
    """Get a single session with all its messages."""
    user_id: str = current_user["sub"]
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
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a session and all its messages."""
    user_id: str = current_user["sub"]
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    db.delete(session)
    db.commit()


# ── Ask ───────────────────────────────────────────────────────────────

@router.post("/ask", response_model=AskResponse)
def ask_question(
    payload: AskRequest,
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AskResponse:
    """Ask a question. If session_id is None a new session is created automatically."""
    user_id: str = current_user["sub"]

    # Resolve or create session
    if payload.session_id is not None:
        session = (
            db.query(ChatSession)
            .filter(
                ChatSession.id == payload.session_id,
                ChatSession.user_id == user_id,
            )
            .first()
        )
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
    else:
        session = ChatSession(
            user_id=user_id,
            title=_first_line(payload.question),
        )
        db.add(session)
        db.flush()  # get session.id

    # Resolve LLM
    llm = None
    if payload.llm_config_id is not None and payload.llm_config_id > 0:
        cfg = get_llm_config(payload.llm_config_id)
        if cfg is None:
            raise HTTPException(status_code=404, detail="大模型配置不存在")
        try:
            llm = create_chat_model(
                provider=cfg.provider,
                model_name=cfg.model_name,
                api_key=cfg.api_key,
                base_url=cfg.base_url,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"无法初始化大模型: {exc}")
    elif payload.llm_config_id is None:
        # Try active config
        active = get_active_llm_config()
        if active is not None:
            try:
                llm = create_chat_model(
                    provider=active.provider,
                    model_name=active.model_name,
                    api_key=active.api_key,
                    base_url=active.base_url,
                )
            except Exception:
                # Silently fall back to fake mode
                pass

    # Retrieve chunks (fake for MVP; real implementation uses pgvector similarity search)
    fake_chunks = [
        {
            "chunk_id": 1,
            "document_id": 1,
            "locator": "page 1",
            "text": "The standard warranty is 12 months from the date of purchase.",
        }
    ]
    result = answer_question(
        question=payload.question,
        retrieved_chunks=fake_chunks,
        system_prompt="请根据公司知识库回答。回答应简洁有用。",
        user_prompt=None,
        llm=llm,
    )

    # Persist message
    msg = ChatMessage(
        session_id=session.id,
        question=payload.question,
        answer=result.answer,
        result_status=result.status,
    )
    db.add(msg)
    db.flush()  # get msg.id

    # Persist citations
    for c in result.citations:
        db.add(
            Citation(
                chat_message_id=msg.id,
                document_id=c["document_id"],
                chunk_id=c["chunk_id"],
                locator=c["locator"],
                quoted_text_preview=c.get("quoted_text_preview", ""),
                rank=1,
            )
        )

    db.commit()

    return AskResponse(
        session_id=session.id,
        message_id=msg.id,
        status=result.status,
        answer=result.answer,
        citations=[
            CitationItem(
                document_id=c["document_id"],
                chunk_id=c["chunk_id"],
                locator=c["locator"],
            )
            for c in result.citations
        ],
    )

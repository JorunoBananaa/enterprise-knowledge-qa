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
    ChatSessionVersionConflict,
    activate_chat_session,
    discard_chat_session,
    fork_chat_session_at_message,
    fork_chat_session_before_message,
    reserve_chat_session_edit,
)
from app.services.chat_persistence import (
    _first_line,
    persist_new_chat_session,
    persist_streamed_chat_message,
    update_session_title_for_first_question,
)
from app.services.llm_factory import create_chat_model
from app.services.qa_orchestrator import QaStreamInput, stream_qa_events
from app.services.qa_tools import QaToolContext
from app.services.retrieval import (
    EvidencePolicy,
    KnowledgeRetriever,
    Principal,
    RetrievalScope,
)
from app.services.rag import (
    answer_question_stream,
    answer_tool_results_stream,
    rewrite_question_for_retrieval,
)

router = APIRouter()
logger = logging.getLogger(__name__)

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


AskCancelKey = tuple[int, str]
_ASK_CANCEL_STATES: dict[AskCancelKey, AskCancelState] = {}


# ── 工具函数 ───────────────────────────────────────────────────────────


def format_sse(event_type: str, data: dict | str | None = None) -> str:
    """格式化 Server-Sent Event 字符串。"""
    if data is None:
        data = {}
    payload = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else data
    return f"event: {event_type}\ndata: {payload}\n\n"


def _replay_completed_request(
    db: Session,
    *,
    user_id: str,
    request_id: str,
) -> StreamingResponse | None:
    message = (
        db.query(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(
            ChatMessage.request_id == request_id,
            ChatSession.user_id == user_id,
            ChatSession.visibility == "active",
        )
        .first()
    )
    if message is None:
        return None

    events = [format_sse("session", {"session_id": message.session_id})]
    if message.answer:
        events.append(format_sse("chunk", {"text": message.answer}))
    citation_rows = (
        db.query(Citation, KnowledgeDocument)
        .outerjoin(
            KnowledgeDocument,
            KnowledgeDocument.id == Citation.document_id,
        )
        .filter(Citation.chat_message_id == message.id)
        .order_by(Citation.rank.asc(), Citation.id.asc())
        .all()
    )
    category_paths = _build_category_path_map(db) if citation_rows else {}
    for citation, document in citation_rows:
        events.append(
            format_sse(
                "citation",
                {
                    "document_id": citation.document_id,
                    "document_title": document.title if document else None,
                    "document_name": document.title if document else None,
                    "document_file_type": document.file_type if document else None,
                    "document_path": (
                        category_paths.get(document.category_id) if document else None
                    ),
                    "document_category_id": document.category_id if document else None,
                    "chunk_id": citation.chunk_id,
                    "locator": citation.locator,
                    "quoted_text_preview": citation.quoted_text_preview,
                    "rank": citation.rank,
                },
            )
        )
    events.append(
        format_sse(
            "done",
            {
                "status": message.result_status,
                "session_id": message.session_id,
                "message_id": message.id,
            },
        )
    )
    return StreamingResponse(
        iter(events),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


def _register_ask_cancel_state(
    user_id: int,
    request_id: str | None,
) -> AskCancelState | None:
    if not request_id:
        return None

    key = (user_id, request_id)
    state = _ASK_CANCEL_STATES.get(key)
    if state is None:
        state = AskCancelState(event=asyncio.Event())
        _ASK_CANCEL_STATES[key] = state

    state.task = asyncio.current_task()
    return state


def _refresh_ask_cancel_task(state: AskCancelState | None) -> None:
    if state is not None:
        state.task = asyncio.current_task()


def _unregister_ask_cancel_state(
    user_id: int,
    request_id: str | None,
    state: AskCancelState | None,
) -> None:
    key = (user_id, request_id) if request_id else None
    if key is not None and _ASK_CANCEL_STATES.get(key) is state:
        _ASK_CANCEL_STATES.pop(key, None)


def _is_ask_cancelled(state: AskCancelState | None) -> bool:
    return bool(state and state.event.is_set())


def _resolve_session(
    user_id: str,
    session_id: int | None,
    question: str,
    db: Session,
) -> ChatSession:
    """解析或创建聊天会话。"""
    if session_id is not None:
        session = (
            db.query(ChatSession)
            .filter(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
                ChatSession.visibility == "active",
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
    """根据配置解析 LLM；没有有效配置时抛出异常。"""
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

    # llm_config_id 为 None 时使用活跃配置
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
    """解析已配置的系统提示词和用户回答偏好。"""
    system_prompt = get_system_prompt_content().strip() or None
    user_prompt = get_user_prompt(user_id).strip() or None
    return system_prompt, user_prompt


def _load_chat_history(
    session_id: int,
    db: Session,
    limit: int = CHAT_HISTORY_LIMIT,
) -> list[dict[str, str]]:
    """按时间顺序加载最近的会话轮次。"""
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
    """给定分类 ID 列表，返回包含所有子孙分类在内的 ID。"""
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
    """构建所有知识分类的展示路径。"""
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
    """解析用于检索过滤的文档 ID 集合。

    如果无需过滤（检索所有文档），返回 None。
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
    """计算查询 embedding（同步执行，可能加载模型权重）。"""
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
        # 远程提供商需要活跃的 LLM 配置来获取 API key
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


# ── 会话 ──────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ChatSessionOut]:
    """列出当前用户的所有会话（最新优先）。"""
    user_id = str(current_user.id)
    sessions = (
        db.query(ChatSession)
        .filter(
            ChatSession.user_id == user_id,
            ChatSession.visibility == "active",
        )
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
                parent_session_id=s.parent_session_id,
                branch_from_message_id=s.branch_from_message_id,
                version=s.version,
                visibility=s.visibility,
            )
        )
    return out


@router.post("/sessions", response_model=ChatSessionOut)
def create_session(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionOut:
    """创建空聊天会话，用于开始新对话。"""
    session = persist_new_chat_session(
        db,
        user_id=str(current_user.id),
        title=None,
    )
    return ChatSessionOut(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        message_count=0,
        parent_session_id=session.parent_session_id,
        branch_from_message_id=session.branch_from_message_id,
        version=session.version,
        visibility=session.visibility,
    )


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(
    session_id: int,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionDetail:
    """获取单个会话及其全部消息。"""
    user_id = str(current_user.id)
    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
            ChatSession.visibility == "active",
        )
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
        parent_session_id=session.parent_session_id,
        branch_from_message_id=session.branch_from_message_id,
        version=session.version,
        visibility=session.visibility,
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
    """删除会话及其全部消息。"""
    user_id = str(current_user.id)
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 先删除引用，再删除消息（引用通过外键关联消息）
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
    """基于一条已完成消息分叉聊天会话。"""
    try:
        new_session = fork_chat_session_at_message(
            db,
            user_id=str(current_user.id),
            message_id=message_id,
        )
    except ChatBranchTargetNotFound:
        raise HTTPException(status_code=404, detail="消息不存在")

    return ForkSessionResponse(session_id=new_session.id)


# ── 提问（流式） ───────────────────────────────────────────────────


@router.get("/requests/{request_id}")
def get_question_request(
    request_id: str,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str | int]:
    message = (
        db.query(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(
            ChatMessage.request_id == request_id,
            ChatSession.user_id == str(current_user.id),
            ChatSession.visibility == "active",
        )
        .first()
    )
    if message is not None:
        return {
            "request_id": request_id,
            "status": message.result_status,
            "session_id": message.session_id,
            "message_id": message.id,
        }
    if (current_user.id, request_id) in _ASK_CANCEL_STATES:
        return {"request_id": request_id, "status": "streaming"}
    raise HTTPException(status_code=404, detail="请求不存在")


@router.post("/ask/cancel")
async def cancel_question_stream(
    payload: AskCancelRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, bool]:
    """取消当前进程中正在进行的流式回答。"""
    state = _ASK_CANCEL_STATES.get((current_user.id, payload.request_id))
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
    """以 SSE 流式响应提问。

    事件：
        session → {"session_id": …}
        chunk   → {"text": "…"}
        citation → {"document_id": …, "document_name": …, "document_path": …, "chunk_id": …, "locator": …}
        done    → {"status": "answered", "session_id": …, "message_id": …}
        error   → {"message": "…"}
    """
    user_id = str(current_user.id)
    replay = _replay_completed_request(
        db,
        user_id=user_id,
        request_id=payload.request_id,
    )
    if replay is not None:
        return replay
    if (current_user.id, payload.request_id) in _ASK_CANCEL_STATES:
        raise HTTPException(status_code=409, detail="相同 request_id 的请求正在执行")
    cancel_state = _register_ask_cancel_state(current_user.id, payload.request_id)
    session: ChatSession | None = None
    edit_branch_session: ChatSession | None = None
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
            request_id=payload.request_id,
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

        # 编辑模式：复制目标消息之前的历史；原会话始终保持不可变。
        if payload.edit_message_id is not None:
            if payload.session_version is None:
                raise HTTPException(
                    status_code=400,
                    detail="编辑会话必须提供 session_version",
                )
            try:
                reserve_chat_session_edit(
                    db,
                    session_id=session.id,
                    user_id=user_id,
                    expected_version=payload.session_version,
                )
            except ChatSessionVersionConflict:
                raise HTTPException(
                    status_code=409,
                    detail="会话已被其他请求修改，请刷新后重试",
                )
            try:
                edit_branch_session = fork_chat_session_before_message(
                    db,
                    user_id=user_id,
                    message_id=payload.edit_message_id,
                )
            except ChatBranchTargetNotFound:
                raise HTTPException(status_code=404, detail="编辑的消息不存在")
            session = edit_branch_session

        if await _should_stop():
            if edit_branch_session is not None:
                discard_chat_session(
                    db, session_id=edit_branch_session.id, user_id=user_id
                )
            else:
                _persist_pre_stream_abort()
            _unregister_ask_cancel_state(
                current_user.id, payload.request_id, cancel_state
            )
            return _empty_stream_response()

        # 同步构建 LLM
        try:
            llm = _resolve_llm(payload.llm_config_id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"无法初始化大模型: {exc}")

        if await _should_stop():
            if edit_branch_session is not None:
                discard_chat_session(
                    db, session_id=edit_branch_session.id, user_id=user_id
                )
            else:
                _persist_pre_stream_abort()
            _unregister_ask_cancel_state(
                current_user.id, payload.request_id, cancel_state
            )
            return _empty_stream_response()

        # 解析范围过滤（分类 → 文档 ID）
        target_document_ids = _resolve_target_document_ids(
            db, payload.category_ids, payload.document_ids,
        )

        system_prompt, user_prompt = _resolve_prompts(current_user.id)
        chat_history = _load_chat_history(session.id, db)

        async def embed_query_for_retrieval(question: str) -> list[float]:
            return await asyncio.to_thread(_compute_query_embedding, question)

        retriever = KnowledgeRetriever(
            db,
            embed_query=embed_query_for_retrieval,
            candidate_k=settings.retrieval_candidate_k,
        )
        evidence_policy = EvidencePolicy(
            min_similarity=settings.retrieval_min_similarity,
            max_evidence=settings.retrieval_max_evidence,
            policy_id=settings.retrieval_policy_id,
        )

        async def retrieve_chunks_for_graph(
            retrieval_question: str,
            target_document_ids_for_graph: list[int] | None,
        ) -> list[dict[str, Any]]:
            result = await retriever.search(
                query=retrieval_question,
                principal=Principal(
                    user_id=current_user.id,
                    role=current_user.role,
                ),
                scope=RetrievalScope(
                    document_ids=(
                        None
                        if target_document_ids_for_graph is None
                        else tuple(target_document_ids_for_graph)
                    )
                ),
                policy=evidence_policy,
            )
            logger.info(
                "retrieval_decision policy_id=%s decision=%s reason=%s "
                "candidate_count=%d evidence_count=%d",
                result.policy_id,
                result.decision.value,
                result.reason,
                len(result.candidates),
                len(result.evidence),
            )
            return result.to_context_chunks()

        if await _should_stop():
            if edit_branch_session is not None:
                discard_chat_session(
                    db, session_id=edit_branch_session.id, user_id=user_id
                )
            else:
                _persist_pre_stream_abort()
            _unregister_ask_cancel_state(
                current_user.id, payload.request_id, cancel_state
            )
            return _empty_stream_response()
    except asyncio.CancelledError:
        if edit_branch_session is not None:
            discard_chat_session(
                db,
                session_id=edit_branch_session.id,
                user_id=user_id,
            )
        if edit_branch_session is None:
            _persist_pre_stream_abort()
        _unregister_ask_cancel_state(
            current_user.id, payload.request_id, cancel_state
        )
        raise
    except Exception:
        if edit_branch_session is not None:
            discard_chat_session(
                db,
                session_id=edit_branch_session.id,
                user_id=user_id,
            )
        _unregister_ask_cancel_state(
            current_user.id, payload.request_id, cancel_state
        )
        raise

    async def _stream_events():
        chunks_received: list[str] = []
        citation_list: list[dict] = []
        persisted_msg: ChatMessage | None = None
        edit_branch_completed = False

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
                request_id=payload.request_id,
            )
            return persisted_msg

        try:
            _refresh_ask_cancel_task(cancel_state)

            if await _should_stop():
                if edit_branch_session is None:
                    persist_message("aborted")
                return

            yield format_sse("session", {"session_id": session.id})

            graph_input = QaStreamInput(
                question=payload.question,
                chat_history=chat_history,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                target_document_ids=target_document_ids,
                llm=llm,
                rewrite_question=rewrite_question_for_retrieval,
                retrieve_chunks=retrieve_chunks_for_graph,
                answer_stream=answer_question_stream,
                tool_answer_stream=answer_tool_results_stream,
                tool_context=QaToolContext(
                    db=db,
                    user_id=current_user.id,
                    role=current_user.role,
                ),
            )

            async for event in stream_qa_events(graph_input):
                if await _should_stop():
                    if edit_branch_session is None:
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

                    if edit_branch_session is not None:
                        activate_chat_session(
                            db,
                            session_id=edit_branch_session.id,
                            user_id=user_id,
                        )
                        edit_branch_completed = True

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
            if edit_branch_session is None:
                persist_message("aborted")
            raise
        except Exception as exc:
            logging.getLogger(__name__).exception("Stream error")
            yield format_sse("error", {"message": f"流式生成失败: {exc}"})
        finally:
            if edit_branch_session is not None and not edit_branch_completed:
                discard_chat_session(
                    db,
                    session_id=edit_branch_session.id,
                    user_id=user_id,
                )
            _unregister_ask_cancel_state(
                current_user.id, payload.request_id, cancel_state
            )

    return StreamingResponse(
        _stream_events(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )

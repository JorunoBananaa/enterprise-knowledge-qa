from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser

from app.services.prompt_composer import (
    ANSWER_PROMPT,
    QUESTION_REWRITE_PROMPT,
    compose_system_message_content,
    compose_user_message_content,
)

logger = logging.getLogger(__name__)

INSUFFICIENT_EVIDENCE_ANSWER = "知识库中没有找到足够的信息来回答这个问题。"


def _build_citations(
    retrieved_chunks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """从检索到的文档块构建引用列表。"""
    return [
        {
            "document_id": chunk["document_id"],
            "document_title": chunk.get("document_title"),
            "document_name": chunk.get("document_name"),
            "document_file_type": chunk.get("document_file_type"),
            "document_storage_path": chunk.get("document_storage_path"),
            "document_path": chunk.get("document_path"),
            "document_category_id": chunk.get("document_category_id"),
            "chunk_id": chunk["chunk_id"],
            "locator": chunk["locator"],
            "quoted_text_preview": chunk["text"][:240],
            "rank": rank,
        }
        for rank, chunk in enumerate(retrieved_chunks, start=1)
    ]


def _history_to_messages(
    chat_history: list[dict[str, str]] | None = None,
) -> list[BaseMessage]:
    """将存储的会话轮次转换为 LangChain 聊天消息。"""
    messages: list[BaseMessage] = []
    for turn in chat_history or []:
        previous_question = (turn.get("question") or "").strip()
        previous_answer = (turn.get("answer") or "").strip()
        if previous_question:
            messages.append(HumanMessage(content=previous_question))
        if previous_answer:
            messages.append(AIMessage(content=previous_answer))
    return messages


def _build_answer_prompt_input(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str | None,
    user_prompt: str | None,
    chat_history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """构建带引用答案 prompt 的输入变量。"""
    return {
        "system_content": compose_system_message_content(system_prompt),
        "history": _history_to_messages(chat_history),
        "user_content": compose_user_message_content(
            user_prompt=user_prompt,
            context_chunks=retrieved_chunks,
            question=question,
        ),
    }


def _clean_rewritten_question(raw_question: str, fallback_question: str) -> str:
    """规范化 LLM 生成的检索改写问题。"""
    question = raw_question.strip()
    if question.startswith("```") and question.endswith("```"):
        question = question.strip("`").strip()

    for prefix in ("Standalone search query:", "Rewritten query:", "Query:"):
        if question.lower().startswith(prefix.lower()):
            question = question[len(prefix):].strip()
            break

    question = question.strip("\"' ")
    return question or fallback_question


async def rewrite_question_for_retrieval(
    question: str,
    chat_history: list[dict[str, str]] | None,
    llm: BaseChatModel,
) -> str:
    """将多轮对话中的追问改写为独立的检索查询。"""
    history_messages = _history_to_messages(chat_history)
    if not history_messages:
        return question

    try:
        chain = QUESTION_REWRITE_PROMPT | llm | StrOutputParser()
        rewritten_question = await chain.ainvoke(
            {
                "history": history_messages,
                "question": question.strip(),
            }
        )
        return _clean_rewritten_question(rewritten_question, question)
    except Exception:
        logger.exception("问题改写失败；使用原始问题")
        return question


async def answer_question_stream(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str | None,
    user_prompt: str | None,
    llm: BaseChatModel,
    chat_history: list[dict[str, str]] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """使用检索到的文档块流式回答问题。

    生成 SSE 风格的事件字典：
        {"type": "chunk", "text": "..."}
        {"type": "citation", ...}
        {"type": "done", "status": "answered"}
        {"type": "error", "message": "..."}
    """
    if not retrieved_chunks:
        yield {"type": "chunk", "text": INSUFFICIENT_EVIDENCE_ANSWER}
        yield {"type": "done", "status": "insufficient_evidence"}
        return

    citations = _build_citations(retrieved_chunks)

    try:
        chain = ANSWER_PROMPT | llm
        async for chunk in chain.astream(
            _build_answer_prompt_input(
                question=question,
                retrieved_chunks=retrieved_chunks,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                chat_history=chat_history,
            )
        ):
            text = chunk.content if hasattr(chunk, "content") else str(chunk)
            if text:
                yield {"type": "chunk", "text": str(text)}

        # 在 token 之后产出引用，使前端能在最后渲染它们
        for c in citations:
            yield {"type": "citation", **c}

        yield {"type": "done", "status": "answered"}
    except Exception as exc:
        logger.exception("LLM 流式调用失败")
        yield {"type": "error", "message": f"LLM 调用失败: {exc}"}

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
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


@dataclass
class RagResult:
    status: str
    answer: str
    citations: list[dict[str, Any]]


def _build_citations(
    retrieved_chunks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build citation list from retrieved chunks."""
    return [
        {
            "document_id": chunk["document_id"],
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
    """Convert stored session turns into LangChain chat messages."""
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
    system_prompt: str,
    user_prompt: str | None,
    chat_history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Build input variables for the grounded answer prompt."""
    return {
        "system_content": compose_system_message_content(system_prompt),
        "history": _history_to_messages(chat_history),
        "user_content": compose_user_message_content(
            user_prompt=user_prompt,
            context_chunks=retrieved_chunks,
            question=question,
        ),
    }


def _build_messages(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str,
    user_prompt: str | None,
    chat_history: list[dict[str, str]] | None = None,
) -> list[BaseMessage]:
    """Render the answer prompt into LangChain messages."""
    prompt_value = ANSWER_PROMPT.invoke(
        _build_answer_prompt_input(
            question=question,
            retrieved_chunks=retrieved_chunks,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            chat_history=chat_history,
        )
    )
    return prompt_value.to_messages()


def _clean_rewritten_question(raw_question: str, fallback_question: str) -> str:
    """Normalize the LLM-produced retrieval question."""
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
    """Rewrite follow-up questions into standalone retrieval queries."""
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
        logger.exception("Question rewrite failed; using original question")
        return question


def answer_question(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str,
    user_prompt: str | None,
    llm: BaseChatModel,
    chat_history: list[dict[str, str]] | None = None,
) -> RagResult:
    """Answer a question using retrieved chunks and the configured LLM."""
    if not retrieved_chunks:
        return RagResult(
            status="insufficient_evidence",
            answer=INSUFFICIENT_EVIDENCE_ANSWER,
            citations=[],
        )

    citations = _build_citations(retrieved_chunks)

    chain = ANSWER_PROMPT | llm
    response = chain.invoke(
        _build_answer_prompt_input(
            question=question,
            retrieved_chunks=retrieved_chunks,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            chat_history=chat_history,
        )
    )
    answer = response.content if hasattr(response, "content") else str(response)
    return RagResult(
        status="answered",
        answer=str(answer),
        citations=citations,
    )


async def answer_question_stream(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str,
    user_prompt: str | None,
    llm: BaseChatModel,
    chat_history: list[dict[str, str]] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Answer a question using retrieved chunks (streaming).

    Yields SSE-style event dicts:
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

        # Yield citations after tokens so frontend can render them last
        for c in citations:
            yield {"type": "citation", **c}

        yield {"type": "done", "status": "answered"}
    except Exception as exc:
        logger.exception("LLM streaming failed")
        yield {"type": "error", "message": f"LLM 调用失败: {exc}"}

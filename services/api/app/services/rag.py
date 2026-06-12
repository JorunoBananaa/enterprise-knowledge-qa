from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from app.services.prompt_composer import compose_prompt

logger = logging.getLogger(__name__)


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
        }
        for chunk in retrieved_chunks
    ]


def answer_question(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str,
    user_prompt: str | None,
    llm: BaseChatModel,
) -> RagResult:
    """Answer a question using retrieved chunks and the configured LLM."""
    if not retrieved_chunks:
        return RagResult(
            status="insufficient_evidence",
            answer="The approved knowledge base does not contain enough evidence to answer this question.",
            citations=[],
        )

    prompt_text = compose_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        context_chunks=[chunk["text"] for chunk in retrieved_chunks],
        question=question,
    )

    citations = _build_citations(retrieved_chunks)

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=prompt_text),
    ]
    response = llm.invoke(messages)
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
) -> AsyncGenerator[dict[str, Any], None]:
    """Answer a question using retrieved chunks (streaming).

    Yields SSE-style event dicts:
        {"type": "chunk", "text": "..."}
        {"type": "citation", ...}
        {"type": "done", "status": "answered"}
        {"type": "error", "message": "..."}
    """
    if not retrieved_chunks:
        yield {"type": "done", "status": "insufficient_evidence"}
        return

    prompt_text = compose_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        context_chunks=[chunk["text"] for chunk in retrieved_chunks],
        question=question,
    )

    citations = _build_citations(retrieved_chunks)

    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt_text),
        ]
        async for chunk in llm.astream(messages):
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

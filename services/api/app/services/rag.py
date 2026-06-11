from __future__ import annotations

import logging
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


def answer_question(
    question: str,
    retrieved_chunks: list[dict[str, Any]],
    system_prompt: str,
    user_prompt: str | None,
    llm: BaseChatModel | None = None,
) -> RagResult:
    """Answer a question using retrieved chunks.

    If `llm` is provided, the composed prompt is sent to that model.
    Otherwise falls back to returning the first chunk text (MVP / fake mode).
    """
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

    citations = [
        {
            "document_id": chunk["document_id"],
            "chunk_id": chunk["chunk_id"],
            "locator": chunk["locator"],
        }
        for chunk in retrieved_chunks
    ]

    # ── Real LLM path ────────────────────────────────────────────
    if llm is not None:
        try:
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
        except Exception as exc:
            logger.exception("LLM invocation failed, falling back to first chunk")
            # Fall through to fake path on error

    # ── Fake / fallback path ─────────────────────────────────────
    first_chunk = retrieved_chunks[0]
    return RagResult(
        status="answered",
        answer=f"{first_chunk['text']}\n\nSource: {first_chunk['locator']}",
        citations=citations[:1],
    )

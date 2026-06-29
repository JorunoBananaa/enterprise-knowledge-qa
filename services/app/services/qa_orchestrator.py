from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from app.services.qa_graph import (
    AnswerStream,
    QaEvent,
    QaGraphContext,
    QaGraphState,
    RetrieveChunks,
    RewriteQuestion,
    ToolAnswerStream,
    run_qa_graph,
)
from app.services.qa_tools import QaToolContext


@dataclass(frozen=True)
class QaStreamInput:
    question: str
    chat_history: list[dict[str, str]] | None
    system_prompt: str | None
    user_prompt: str | None
    target_document_ids: list[int] | None
    llm: Any
    rewrite_question: RewriteQuestion
    retrieve_chunks: RetrieveChunks
    answer_stream: AnswerStream
    tool_answer_stream: ToolAnswerStream | None = None
    tool_context: QaToolContext | None = None


async def stream_qa_events(payload: QaStreamInput) -> AsyncIterator[QaEvent]:
    state = QaGraphState(
        question=payload.question,
        chat_history=payload.chat_history,
        system_prompt=payload.system_prompt,
        user_prompt=payload.user_prompt,
        target_document_ids=payload.target_document_ids,
    )
    context = QaGraphContext(
        llm=payload.llm,
        rewrite_question=payload.rewrite_question,
        retrieve_chunks=payload.retrieve_chunks,
        answer_stream=payload.answer_stream,
        tool_answer_stream=payload.tool_answer_stream,
        tool_context=payload.tool_context,
    )
    async for event in run_qa_graph(state, context):
        yield event

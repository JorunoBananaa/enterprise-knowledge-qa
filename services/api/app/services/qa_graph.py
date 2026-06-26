from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

logger = logging.getLogger(__name__)

QaEvent = dict[str, Any]
RewriteQuestion = Callable[[str, list[dict[str, str]] | None, Any], Awaitable[str]]
RetrieveChunks = Callable[[str, list[int] | None], Awaitable[list[dict[str, Any]]]]
AnswerStream = Callable[..., AsyncIterator[QaEvent]]


@dataclass
class QaGraphState:
    question: str
    chat_history: list[dict[str, str]] | None = None
    system_prompt: str | None = None
    user_prompt: str | None = None
    target_document_ids: list[int] | None = None
    retrieval_question: str | None = None
    retrieved_chunks: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class QaGraphContext:
    llm: Any
    rewrite_question: RewriteQuestion
    retrieve_chunks: RetrieveChunks
    answer_stream: AnswerStream


class _GraphState(TypedDict, total=False):
    question: str
    chat_history: list[dict[str, str]] | None
    system_prompt: str | None
    user_prompt: str | None
    target_document_ids: list[int] | None
    retrieval_question: str | None
    retrieved_chunks: list[dict[str, Any]]


def _to_graph_state(state: QaGraphState) -> _GraphState:
    return {
        "question": state.question,
        "chat_history": state.chat_history,
        "system_prompt": state.system_prompt,
        "user_prompt": state.user_prompt,
        "target_document_ids": state.target_document_ids,
        "retrieval_question": state.retrieval_question,
        "retrieved_chunks": list(state.retrieved_chunks),
    }


def _build_graph(context: QaGraphContext):
    async def load_context(state: _GraphState) -> _GraphState:
        return state

    async def rewrite_query(state: _GraphState) -> _GraphState:
        question = state["question"]
        try:
            retrieval_question = await context.rewrite_question(
                question,
                state.get("chat_history"),
                context.llm,
            )
        except Exception:
            logger.exception("Question rewrite failed inside QA graph; using original question")
            retrieval_question = question

        return {"retrieval_question": retrieval_question or question}

    async def retrieve_chunks(state: _GraphState) -> _GraphState:
        retrieval_question = state.get("retrieval_question") or state["question"]
        chunks = await context.retrieve_chunks(
            retrieval_question,
            state.get("target_document_ids"),
        )
        return {"retrieved_chunks": chunks}

    async def generate_answer(state: _GraphState) -> _GraphState:
        return state

    async def build_result(state: _GraphState) -> _GraphState:
        return state

    graph = StateGraph(_GraphState)
    graph.add_node("load_context", load_context)
    graph.add_node("rewrite_query", rewrite_query)
    graph.add_node("retrieve_chunks", retrieve_chunks)
    graph.add_node("generate_answer", generate_answer)
    graph.add_node("build_result", build_result)
    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "rewrite_query")
    graph.add_edge("rewrite_query", "retrieve_chunks")
    graph.add_edge("retrieve_chunks", "generate_answer")
    graph.add_edge("generate_answer", "build_result")
    graph.add_edge("build_result", END)
    return graph.compile()


async def run_qa_graph(
    state: QaGraphState,
    context: QaGraphContext,
) -> AsyncIterator[QaEvent]:
    graph = _build_graph(context)
    final_state = await graph.ainvoke(_to_graph_state(state))
    async for event in context.answer_stream(
        question=final_state["question"],
        retrieved_chunks=final_state.get("retrieved_chunks") or [],
        system_prompt=final_state.get("system_prompt"),
        user_prompt=final_state.get("user_prompt"),
        llm=context.llm,
        chat_history=final_state.get("chat_history"),
    ):
        yield event

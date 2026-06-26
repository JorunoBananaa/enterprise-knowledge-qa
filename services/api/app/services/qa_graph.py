from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.qa_tools import (
    QaToolContext,
    QaToolPlan,
    QaToolResult,
    execute_qa_tool_plans,
    plan_qa_tools,
)

logger = logging.getLogger(__name__)

QaEvent = dict[str, Any]
RewriteQuestion = Callable[[str, list[dict[str, str]] | None, Any], Awaitable[str]]
RetrieveChunks = Callable[[str, list[int] | None], Awaitable[list[dict[str, Any]]]]
AnswerStream = Callable[..., AsyncIterator[QaEvent]]
ToolAnswerStream = Callable[..., AsyncIterator[QaEvent]]


@dataclass
class QaGraphState:
    question: str
    chat_history: list[dict[str, str]] | None = None
    system_prompt: str | None = None
    user_prompt: str | None = None
    target_document_ids: list[int] | None = None
    retrieval_question: str | None = None
    retrieved_chunks: list[dict[str, Any]] = field(default_factory=list)
    tool_plans: list[QaToolPlan] = field(default_factory=list)
    tool_results: list[QaToolResult] = field(default_factory=list)


@dataclass(frozen=True)
class QaGraphContext:
    llm: Any
    rewrite_question: RewriteQuestion
    retrieve_chunks: RetrieveChunks
    answer_stream: AnswerStream
    tool_answer_stream: ToolAnswerStream | None = None
    tool_context: QaToolContext | None = None


class _GraphState(TypedDict, total=False):
    question: str
    chat_history: list[dict[str, str]] | None
    system_prompt: str | None
    user_prompt: str | None
    target_document_ids: list[int] | None
    retrieval_question: str | None
    retrieved_chunks: list[dict[str, Any]]
    tool_plans: list[QaToolPlan]
    tool_results: list[QaToolResult]


def _to_graph_state(state: QaGraphState) -> _GraphState:
    return {
        "question": state.question,
        "chat_history": state.chat_history,
        "system_prompt": state.system_prompt,
        "user_prompt": state.user_prompt,
        "target_document_ids": state.target_document_ids,
        "retrieval_question": state.retrieval_question,
        "retrieved_chunks": list(state.retrieved_chunks),
        "tool_plans": list(state.tool_plans),
        "tool_results": list(state.tool_results),
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

    async def plan_tools(state: _GraphState) -> _GraphState:
        tool_plans = await plan_qa_tools(
            state["question"],
            context.llm,
            chat_history=state.get("chat_history"),
        )
        return {"tool_plans": tool_plans}

    async def run_tools(state: _GraphState) -> _GraphState:
        tool_results = execute_qa_tool_plans(
            context.tool_context,
            state.get("tool_plans") or [],
        )
        return {"tool_results": tool_results}

    def route_after_tools(state: _GraphState) -> Literal["retrieve_chunks", "generate_answer"]:
        if state.get("tool_results"):
            return "generate_answer"
        return "retrieve_chunks"

    async def generate_answer(state: _GraphState) -> _GraphState:
        return state

    async def build_result(state: _GraphState) -> _GraphState:
        return state

    graph = StateGraph(_GraphState)
    graph.add_node("load_context", load_context)
    graph.add_node("rewrite_query", rewrite_query)
    graph.add_node("retrieve_chunks", retrieve_chunks)
    graph.add_node("plan_tools", plan_tools)
    graph.add_node("run_tools", run_tools)
    graph.add_node("generate_answer", generate_answer)
    graph.add_node("build_result", build_result)
    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "rewrite_query")
    graph.add_edge("rewrite_query", "plan_tools")
    graph.add_edge("plan_tools", "run_tools")
    graph.add_conditional_edges(
        "run_tools",
        route_after_tools,
        ["retrieve_chunks", "generate_answer"],
    )
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
    answer_stream = (
        context.tool_answer_stream
        if final_state.get("tool_results") and context.tool_answer_stream is not None
        else context.answer_stream
    )

    async for event in answer_stream(
        question=final_state["question"],
        retrieved_chunks=final_state.get("retrieved_chunks") or [],
        system_prompt=final_state.get("system_prompt"),
        user_prompt=final_state.get("user_prompt"),
        llm=context.llm,
        chat_history=final_state.get("chat_history"),
        tool_results=final_state.get("tool_results") or [],
    ):
        yield event

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from app.services.qa_graph import QaGraphContext, QaGraphState, run_qa_graph
from app.services.qa_tools.types import QaToolContext, QaToolResult


async def _rewrite_question(question: str, _history: object, _llm: object) -> str:
    return question


async def _retrieve_chunks(_question: str, _target_ids: object) -> list[dict[str, object]]:
    return []


async def _answer_stream(**kwargs: object) -> AsyncIterator[dict[str, object]]:
    for result in kwargs["tool_results"]:
        yield {"type": "chunk", "text": result.content}
    yield {"type": "done", "status": "answered"}


async def _tool_answer_stream(**kwargs: object) -> AsyncIterator[dict[str, object]]:
    assert kwargs["question"] == "现在一共有几个暂未处理的审核，告诉我数量即可"
    assert kwargs["tool_results"] == [
        QaToolResult(
            name="review_list",
            content="当前共有 1 个待审核文档。",
            metadata={"total": 1, "output_mode": "count_only"},
        )
    ]
    yield {"type": "chunk", "text": "当前共有 1 个。"}
    yield {"type": "done", "status": "answered"}


class _NoToolLlm:
    def bind_tools(self, _tools: object) -> "_NoToolLlm":
        return self

    async def ainvoke(self, _messages: object) -> object:
        return type("ToolChoice", (), {"tool_calls": []})()


class _ReviewCountLlm:
    def bind_tools(self, _tools: object) -> "_ReviewCountLlm":
        return self

    async def ainvoke(self, _messages: object) -> object:
        return type(
            "ToolChoice",
            (),
            {"tool_calls": [{"name": "review_list", "args": {"output_mode": "count_only"}}]},
        )()


@pytest.mark.asyncio
async def test_qa_graph_uses_tool_answer_stream_for_tool_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.qa_tools.registry.get_review_list",
        lambda _context, output_mode="table": QaToolResult(
            name="review_list",
            content="当前共有 1 个待审核文档。",
            metadata={"total": 1, "output_mode": output_mode},
        ),
    )
    context = QaGraphContext(
        llm=_ReviewCountLlm(),
        rewrite_question=_rewrite_question,
        retrieve_chunks=_retrieve_chunks,
        answer_stream=_answer_stream,
        tool_answer_stream=_tool_answer_stream,
        tool_context=QaToolContext(role="admin"),
    )

    events = [
        event
        async for event in run_qa_graph(
            QaGraphState(question="现在一共有几个暂未处理的审核，告诉我数量即可"),
            context,
        )
    ]

    assert events == [
        {"type": "chunk", "text": "当前共有 1 个。"},
        {"type": "done", "status": "answered"},
    ]

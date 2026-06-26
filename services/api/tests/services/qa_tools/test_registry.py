from __future__ import annotations

import pytest

from app.services.qa_tools.registry import run_qa_tools
from app.services.qa_tools.review_list import REVIEW_LIST_TOOL_NAME
from app.services.qa_tools.types import QaToolContext


class _ToolChoosingLlm:
    def __init__(self, tool_calls: list[dict[str, object]]) -> None:
        self.tool_calls = tool_calls

    def bind_tools(self, tools: object) -> "_ToolChoosingLlm":
        return self

    async def ainvoke(self, messages: object) -> object:
        return type("ToolChoice", (), {"tool_calls": self.tool_calls})()


@pytest.mark.asyncio
async def test_run_qa_tools_passes_review_list_output_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def get_review_list(context: QaToolContext, output_mode: str = "table"):
        calls.append(output_mode)
        from app.services.qa_tools.types import QaToolResult

        return QaToolResult(
            name=REVIEW_LIST_TOOL_NAME,
            content="当前共有 1 个待审核文档。",
            metadata={"output_mode": output_mode},
        )

    monkeypatch.setattr("app.services.qa_tools.registry.get_review_list", get_review_list)
    llm = _ToolChoosingLlm(
        [{"name": REVIEW_LIST_TOOL_NAME, "args": {"output_mode": "count_only"}}]
    )

    results = await run_qa_tools(
        "现在一共有几个暂未处理的审核，告诉我数量即可",
        QaToolContext(role="admin"),
        llm,
    )

    assert calls == ["count_only"]
    assert results[0].metadata["output_mode"] == "count_only"

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.services.qa_tools.review_approval import (
    REVIEW_APPROVAL_TOOL_NAME,
    approve_review,
    approve_review_tool,
)
from app.services.qa_tools.review_list import (
    REVIEW_LIST_TOOL_NAME,
    get_review_list,
    review_list_tool,
)
from app.services.qa_tools.types import QaToolContext, QaToolResult

logger = logging.getLogger(__name__)

_TOOL_SELECTION_SYSTEM_PROMPT = """你负责判断用户当前问题是否需要调用内部 QA 工具。
只有在工具与用户当前问题直接相关时才调用；如果不需要工具，请不要返回任何工具调用。"""


async def run_qa_tools(
    question: str,
    context: QaToolContext | None,
    llm: Any,
    chat_history: list[dict[str, str]] | None = None,
) -> list[QaToolResult]:
    if context is None or llm is None:
        return []

    tool_calls = await _select_tools(question, llm, chat_history)

    results: list[QaToolResult] = []
    for tool_call in tool_calls:
        tool_name = tool_call.get("name")
        if tool_name == REVIEW_LIST_TOOL_NAME:
            results.append(get_review_list(context))
        elif tool_name == REVIEW_APPROVAL_TOOL_NAME:
            results.append(approve_review(context, _get_document_id(tool_call)))

    return results


async def _select_tools(
    question: str,
    llm: Any,
    chat_history: list[dict[str, str]] | None,
) -> list[dict[str, Any]]:
    try:
        response = await llm.bind_tools([review_list_tool, approve_review_tool]).ainvoke(
            _build_tool_selection_messages(question, chat_history)
        )
    except Exception:
        logger.exception("QA 工具选择失败；跳过工具继续处理")
        return []

    return [
        tool_call
        for tool_call in getattr(response, "tool_calls", []) or []
        if tool_call.get("name")
    ]


def _build_tool_selection_messages(
    question: str,
    chat_history: list[dict[str, str]] | None,
) -> list[BaseMessage]:
    messages: list[BaseMessage] = [SystemMessage(content=_TOOL_SELECTION_SYSTEM_PROMPT)]
    for turn in chat_history or []:
        previous_question = (turn.get("question") or "").strip()
        previous_answer = (turn.get("answer") or "").strip()
        if previous_question:
            messages.append(HumanMessage(content=previous_question))
        if previous_answer:
            messages.append(AIMessage(content=previous_answer))

    messages.append(HumanMessage(content=question))
    return messages


def _get_document_id(tool_call: dict[str, Any]) -> int | None:
    args = tool_call.get("args") or {}
    value = args.get("document_id") or args.get("id")
    if value is None:
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None

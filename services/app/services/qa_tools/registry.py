from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.services.qa_tools.document_detail import (
    DOCUMENT_DETAIL_TOOL_NAME,
    document_detail_tool,
    get_document_detail,
)
from app.services.qa_tools.review_approval import (
    REVIEW_APPROVAL_TOOL_NAME,
    approve_review,
    approve_review_tool,
)
from app.services.qa_tools.review_rejection import (
    REVIEW_REJECTION_TOOL_NAME,
    reject_review,
    reject_review_tool,
)
from app.services.qa_tools.review_list import (
    REVIEW_LIST_TOOL_NAME,
    ReviewListOutputMode,
    get_review_list,
    review_list_tool,
)
from app.services.qa_tools.types import QaToolContext, QaToolPlan, QaToolResult

logger = logging.getLogger(__name__)

UNSUPPORTED_TOOL_REQUEST_NAME = "unsupported_tool_request"

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

    tool_plans = await plan_qa_tools(question, llm, chat_history)
    return execute_qa_tool_plans(context, tool_plans)


async def plan_qa_tools(
    question: str,
    llm: Any,
    chat_history: list[dict[str, str]] | None = None,
) -> list[QaToolPlan]:
    tool_calls = await _select_tools(question, llm, chat_history)
    if not tool_calls and _looks_like_tool_request(question):
        return [QaToolPlan(name=UNSUPPORTED_TOOL_REQUEST_NAME, args={"question": question})]

    return [
        QaToolPlan(name=tool_call["name"], args=tool_call.get("args") or {})
        for tool_call in tool_calls
    ]


def execute_qa_tool_plans(
    context: QaToolContext | None,
    tool_plans: list[QaToolPlan],
) -> list[QaToolResult]:
    if context is None:
        return []

    results: list[QaToolResult] = []
    for tool_plan in tool_plans:
        if tool_plan.name == REVIEW_LIST_TOOL_NAME:
            results.append(get_review_list(context, _get_review_list_output_mode(tool_plan)))
        elif tool_plan.name == REVIEW_APPROVAL_TOOL_NAME:
            results.append(approve_review(context, _get_document_id(tool_plan)))
        elif tool_plan.name == DOCUMENT_DETAIL_TOOL_NAME:
            results.append(get_document_detail(context, _get_document_id(tool_plan)))
        elif tool_plan.name == REVIEW_REJECTION_TOOL_NAME:
            results.append(
                reject_review(context, _get_document_id(tool_plan), _get_reason(tool_plan))
            )
        elif tool_plan.name == UNSUPPORTED_TOOL_REQUEST_NAME:
            results.append(_unsupported_tool_result(tool_plan))

    return results


async def _select_tools(
    question: str,
    llm: Any,
    chat_history: list[dict[str, str]] | None,
) -> list[dict[str, Any]]:
    try:
        response = await llm.bind_tools(
            [
                review_list_tool,
                approve_review_tool,
                document_detail_tool,
                reject_review_tool,
            ]
        ).ainvoke(_build_tool_selection_messages(question, chat_history))
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


def _get_document_id(tool_plan: QaToolPlan) -> int | None:
    args = tool_plan.args
    value = args.get("document_id") or args.get("id")
    if value is None:
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _get_reason(tool_plan: QaToolPlan) -> str | None:
    value = tool_plan.args.get("reason")
    if value is None:
        return None
    reason = str(value).strip()
    return reason or None


def _looks_like_tool_request(question: str) -> bool:
    normalized = question.strip()
    if not normalized:
        return False

    document_operation_markers = ("找出", "查找", "查询", "列出", "查看", "筛选", "搜索", "统计")
    document_targets = ("文档", "文件", "资料", "材料")
    management_targets = ("审核", "审批", "索引", "状态")

    if any(marker in normalized for marker in document_operation_markers) and any(
        target in normalized for target in document_targets
    ):
        return True

    if any(marker in normalized for marker in document_operation_markers) and any(
        target in normalized for target in management_targets
    ):
        return True

    return False


def _unsupported_tool_result(tool_plan: QaToolPlan) -> QaToolResult:
    question = str(tool_plan.args.get("question") or "").strip()
    detail = f"“{question}”" if question else "这个请求"
    return QaToolResult(
        name=UNSUPPORTED_TOOL_REQUEST_NAME,
        content=(
            f"当前没有可用工具可以可靠完成{detail}，因此已停止处理，避免改走普通检索链路或误用其他工具。"
            "请新增或启用对应工具后再试。"
        ),
        metadata={"error": "unsupported_tool_request", "question": question or None},
    )


def _get_review_list_output_mode(tool_plan: QaToolPlan) -> ReviewListOutputMode:
    args = tool_plan.args
    if args.get("output_mode") == "count_only":
        return "count_only"
    return "table"

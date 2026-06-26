from __future__ import annotations

from typing import Any

from langchain_core.tools import tool

from app.models.document import KnowledgeDocument
from app.services.qa_tools.types import QaToolContext, QaToolResult

DOCUMENT_DETAIL_TOOL_NAME = "document_detail"


@tool(DOCUMENT_DETAIL_TOOL_NAME)
def document_detail_tool(document_id: int) -> str:
    """查询指定文档的审核状态、索引状态和基础信息。

    当用户想确认某个文档是否存在、当前审核状态、索引状态或失败原因时使用。
    """
    return f"查询文档 {document_id} 的详情。"


def get_document_detail(context: QaToolContext, document_id: int | None) -> QaToolResult:
    if context.role != "admin":
        return QaToolResult(
            name=DOCUMENT_DETAIL_TOOL_NAME,
            content="无法查询文档详情：需要管理员权限。",
            metadata={"error": "permission_denied"},
        )

    if document_id is None:
        return QaToolResult(
            name=DOCUMENT_DETAIL_TOOL_NAME,
            content="无法查询文档详情：缺少文档 ID。",
            metadata={"error": "missing_document_id"},
        )

    if context.db is None:
        return QaToolResult(
            name=DOCUMENT_DETAIL_TOOL_NAME,
            content="无法查询文档详情：缺少数据库上下文。",
            metadata={"error": "missing_db_context", "document_id": document_id},
        )

    document = (
        context.db.query(KnowledgeDocument)
        .filter(KnowledgeDocument.id == document_id)
        .first()
    )
    if document is None:
        return QaToolResult(
            name=DOCUMENT_DETAIL_TOOL_NAME,
            content=f"未找到 ID 为 {document_id} 的文档。",
            metadata={"error": "document_not_found", "document_id": document_id},
        )

    review_status = _enum_value(document.review_status)
    index_status = _enum_value(document.index_status)
    failure_reason = document.failure_reason or "-"
    content = "\n".join(
        [
            f"文档 {document.id}（{document.title}）",
            f"- 类型：{document.file_type}",
            f"- 分类 ID：{document.category_id}",
            f"- 上传者 ID：{document.uploader_id}",
            f"- 审核状态：{review_status}",
            f"- 索引状态：{index_status}",
            f"- 失败原因：{failure_reason}",
        ]
    )

    return QaToolResult(
        name=DOCUMENT_DETAIL_TOOL_NAME,
        content=content,
        metadata={
            "document_id": document.id,
            "review_status": review_status,
            "index_status": index_status,
            "failure_reason": document.failure_reason,
        },
    )


def _enum_value(value: Any) -> str:
    return str(value.value if hasattr(value, "value") else value)

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.document import DocumentReviewStatus, KnowledgeDocument
from app.services.qa_tools.types import QaToolContext, QaToolResult

REVIEW_LIST_TOOL_NAME = "review_list"


@tool(REVIEW_LIST_TOOL_NAME)
def review_list_tool() -> str:
    """获取管理员可查看的待审核文档列表。

    当用户想查看正在等待审核、批准、复核或流程处理的文档时使用。
    """
    return "获取待审核文档列表。"


def get_review_list(context: QaToolContext) -> QaToolResult:
    if context.role != "admin":
        return QaToolResult(
            name=REVIEW_LIST_TOOL_NAME,
            content="无法获取审核列表：需要管理员权限。",
            metadata={"error": "permission_denied"},
        )

    if context.db is None:
        return QaToolResult(
            name=REVIEW_LIST_TOOL_NAME,
            content="无法获取审核列表：缺少数据库上下文。",
            metadata={"error": "missing_db_context"},
        )

    db: Session = context.db
    limit = max(1, min(context.limit, 100))
    query = db.query(KnowledgeDocument).filter(
        KnowledgeDocument.review_status == DocumentReviewStatus.PENDING_REVIEW
    )
    total = query.count()
    documents = query.order_by(KnowledgeDocument.id.desc()).limit(limit).all()

    if not documents:
        content = "当前没有待审核文档。"
    else:
        rows = [
            "| ID | 标题 | 类型 | 上传者 | 索引状态 |",
            "| --- | --- | --- | --- | --- |",
        ]
        rows.extend(_format_document_row(document) for document in documents)
        content = "\n".join(
            [
                f"当前共有 {total} 个待审核文档，展示最新 {len(documents)} 个：",
                "",
                *rows,
            ]
        )

    return QaToolResult(
        name=REVIEW_LIST_TOOL_NAME,
        content=content,
        metadata={"total": total, "limit": limit},
    )


def _format_document_row(document: Any) -> str:
    return (
        f"| {document.id} | {_escape_cell(document.title)} | "
        f"{_escape_cell(document.file_type)} | #{document.uploader_id} | "
        f"{_escape_cell(document.index_status)} |"
    )


def _escape_cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()

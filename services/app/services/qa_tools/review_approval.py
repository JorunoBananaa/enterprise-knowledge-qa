from __future__ import annotations

from langchain_core.tools import tool

from app.models.document import DocumentIndexStatus, DocumentReviewStatus
from app.repositories.documents import get_document_by_id, update_document
from app.services.indexing import index_document
from app.services.qa_tools.types import QaToolContext, QaToolResult

REVIEW_APPROVAL_TOOL_NAME = "approve_review"


@tool(REVIEW_APPROVAL_TOOL_NAME)
def approve_review_tool(document_id: int) -> str:
    """通过指定文档的审核。

    当管理员明确要求通过、批准或同意某个文档审核，并提供文档 ID 时使用。
    """
    return f"通过文档 {document_id} 的审核。"


def approve_review(context: QaToolContext, document_id: int | None) -> QaToolResult:
    if context.role != "admin":
        return QaToolResult(
            name=REVIEW_APPROVAL_TOOL_NAME,
            content="无法通过审核：需要管理员权限。",
            metadata={"error": "permission_denied"},
        )

    if document_id is None:
        return QaToolResult(
            name=REVIEW_APPROVAL_TOOL_NAME,
            content="无法通过审核：缺少文档 ID。",
            metadata={"error": "missing_document_id"},
        )

    doc = get_document_by_id(document_id)
    if doc is None:
        return QaToolResult(
            name=REVIEW_APPROVAL_TOOL_NAME,
            content=f"无法通过审核：未找到 ID 为 {document_id} 的文档。",
            metadata={"error": "document_not_found", "document_id": document_id},
        )

    index_document(document_id)

    doc = get_document_by_id(document_id)
    if doc is None:
        return QaToolResult(
            name=REVIEW_APPROVAL_TOOL_NAME,
            content=f"无法通过审核：未找到 ID 为 {document_id} 的文档。",
            metadata={"error": "document_not_found", "document_id": document_id},
        )

    if doc.index_status != DocumentIndexStatus.INDEXED.value:
        return QaToolResult(
            name=REVIEW_APPROVAL_TOOL_NAME,
            content=f"无法通过审核：{doc.failure_reason or '文档索引失败'}。",
            metadata={"error": "index_failed", "document_id": document_id},
        )

    updated = update_document(document_id, review_status=DocumentReviewStatus.APPROVED)
    if updated is None:
        return QaToolResult(
            name=REVIEW_APPROVAL_TOOL_NAME,
            content="无法通过审核：文档更新失败。",
            metadata={"error": "update_failed", "document_id": document_id},
        )

    return QaToolResult(
        name=REVIEW_APPROVAL_TOOL_NAME,
        content=f"文档 {document_id}（{updated.title}）已通过审核。",
        metadata={
            "document_id": document_id,
            "review_status": DocumentReviewStatus.APPROVED.value,
        },
    )

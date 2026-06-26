from __future__ import annotations

from langchain_core.tools import tool

from app.models.document import DocumentReviewStatus
from app.repositories.documents import get_document_by_id, update_document
from app.services.qa_tools.types import QaToolContext, QaToolResult

REVIEW_REJECTION_TOOL_NAME = "reject_review"


@tool(REVIEW_REJECTION_TOOL_NAME)
def reject_review_tool(document_id: int, reason: str | None = None) -> str:
    """驳回指定文档的审核。

    当管理员明确要求驳回、拒绝或不通过某个文档审核，并提供文档 ID 时使用。
    如果用户说明了原因，将原因写入 reason。
    """
    if reason:
        return f"驳回文档 {document_id} 的审核，原因：{reason}。"
    return f"驳回文档 {document_id} 的审核。"


def reject_review(
    context: QaToolContext,
    document_id: int | None,
    reason: str | None = None,
) -> QaToolResult:
    if context.role != "admin":
        return QaToolResult(
            name=REVIEW_REJECTION_TOOL_NAME,
            content="无法驳回审核：需要管理员权限。",
            metadata={"error": "permission_denied"},
        )

    if document_id is None:
        return QaToolResult(
            name=REVIEW_REJECTION_TOOL_NAME,
            content="无法驳回审核：缺少文档 ID。",
            metadata={"error": "missing_document_id"},
        )

    doc = get_document_by_id(document_id)
    if doc is None:
        return QaToolResult(
            name=REVIEW_REJECTION_TOOL_NAME,
            content=f"无法驳回审核：未找到 ID 为 {document_id} 的文档。",
            metadata={"error": "document_not_found", "document_id": document_id},
        )

    kwargs: dict[str, object] = {"review_status": DocumentReviewStatus.REJECTED}
    normalized_reason = (reason or "").strip()
    if normalized_reason:
        kwargs["failure_reason"] = normalized_reason

    updated = update_document(document_id, **kwargs)
    if updated is None:
        return QaToolResult(
            name=REVIEW_REJECTION_TOOL_NAME,
            content="无法驳回审核：文档更新失败。",
            metadata={"error": "update_failed", "document_id": document_id},
        )

    content = f"文档 {document_id}（{updated.title}）已驳回。"
    if normalized_reason:
        content += f"原因：{normalized_reason}"

    return QaToolResult(
        name=REVIEW_REJECTION_TOOL_NAME,
        content=content,
        metadata={
            "document_id": document_id,
            "review_status": DocumentReviewStatus.REJECTED.value,
            "failure_reason": normalized_reason or None,
        },
    )

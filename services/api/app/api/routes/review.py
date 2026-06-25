from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import require_admin
from app.models.document import DocumentReviewStatus
from app.repositories.documents import get_document_by_id, update_document
from app.schemas.auth import CurrentUser
from app.schemas.document import DocumentResponse
from app.services.indexing import index_document

router = APIRouter()


@router.post("/documents/{document_id}/approve")
def approve_document(
    document_id: int,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> DocumentResponse:
    """审批文档并触发索引构建。"""
    doc = get_document_by_id(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档未找到")

    updated = update_document(document_id, review_status=DocumentReviewStatus.APPROVED)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="文档更新失败")

    # 同步执行索引构建
    index_document(document_id)

    # 重新读取以获取最新的 index_status
    doc = get_document_by_id(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档未找到")
    return DocumentResponse.from_orm_obj(doc)


@router.post("/documents/{document_id}/reject")
def reject_document(
    document_id: int,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    reason: Annotated[str | None, Query()] = None,
) -> DocumentResponse:
    """驳回文档，可选填写驳回原因。"""
    doc = get_document_by_id(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档未找到")

    kwargs = {"review_status": DocumentReviewStatus.REJECTED}
    if reason:
        kwargs["failure_reason"] = reason
    updated = update_document(document_id, **kwargs)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="文档更新失败")
    return DocumentResponse.from_orm_obj(updated)

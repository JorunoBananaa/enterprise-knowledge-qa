from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_user, require_admin
from app.models.document import DocumentReviewStatus
from app.repositories.documents import get_document_by_id, update_document
from app.schemas.document import DocumentResponse
from app.services.indexing import index_document

router = APIRouter()


@router.post("/documents/{document_id}/approve")
def approve_document(
    document_id: int,
    _admin: Annotated[dict[str, str], Depends(require_admin)],
) -> DocumentResponse:
    """Approve a document and trigger indexing."""
    doc = get_document_by_id(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档未找到")

    updated = update_document(document_id, review_status=DocumentReviewStatus.APPROVED)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="文档更新失败")

    # Run indexing synchronously
    index_document(document_id)

    # Re-read to get the latest index_status
    doc = get_document_by_id(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档未找到")
    return DocumentResponse.from_orm_obj(doc)


@router.post("/documents/{document_id}/reject")
def reject_document(
    document_id: int,
    _admin: Annotated[dict[str, str], Depends(require_admin)],
    reason: Annotated[str | None, Query()] = None,
) -> DocumentResponse:
    """Reject a document with an optional reason."""
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

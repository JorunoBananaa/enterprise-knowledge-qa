from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from app.api.deps import get_current_user
from app.repositories.documents import create_document, list_documents
from app.schemas.auth import CurrentUser
from app.schemas.document import DocumentListResponse, DocumentResponse
from app.services.storage import save_upload

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_document(
    title: Annotated[str, Form()],
    category_id: Annotated[int, Form()],
    file: Annotated[UploadFile, File()],
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> DocumentResponse:
    """Upload a document for review."""
    storage_path = save_upload(file)

    uploader_id = current_user.id

    doc = create_document(
        {
            "title": title,
            "file_type": file.filename.split(".")[-1] if file.filename else "unknown",
            "storage_path": storage_path,
            "uploader_id": uploader_id,
            "category_id": category_id,
        }
    )
    return DocumentResponse.from_orm_obj(doc)


@router.get("")
def get_documents(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    category_id: int | None = Query(None),
    review_status: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> DocumentListResponse:
    """List documents with optional filters."""
    items, total = list_documents(
        category_id=category_id,
        review_status=review_status,
        offset=offset,
        limit=limit,
    )
    return DocumentListResponse(
        items=[DocumentResponse.from_orm_obj(d) for d in items],
        total=total,
    )

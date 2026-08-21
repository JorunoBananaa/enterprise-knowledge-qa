from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.repositories.categories import get_category_by_id
from app.repositories.documents import (
    create_documents,
    delete_document,
    get_document_by_id,
    list_documents,
)
from app.schemas.auth import CurrentUser
from app.schemas.document import DocumentListResponse, DocumentResponse, DocumentUploadResponse
from app.services.storage import UploadRejectedError, delete_upload, save_upload

router = APIRouter()


def _file_type(filename: str | None) -> str:
    if not filename or "." not in filename:
        return "unknown"
    return filename.rsplit(".", 1)[-1].lower()


def _title_from_filename(filename: str | None) -> str:
    if not filename:
        return "未命名文档"
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return stem or filename


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_document(
    category_id: Annotated[int, Form()],
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    title: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> DocumentResponse | DocumentUploadResponse:
    """上传待审核文档。"""
    upload_files = [*list(files or [])]
    if file is not None:
        upload_files.append(file)
    if not upload_files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="请选择文件",
        )
    if len(upload_files) > settings.upload_max_files_per_request:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"单次最多上传 {settings.upload_max_files_per_request} 个文件",
        )
    if get_category_by_id(db, category_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="知识分类不存在",
        )

    uploader_id = current_user.id
    pending_documents: list[dict[str, Any]] = []
    saved_paths: list[str] = []
    try:
        for upload_file in upload_files:
            storage_path = save_upload(upload_file)
            saved_paths.append(storage_path)
            doc_title = (
                title
                if len(upload_files) == 1 and title
                else _title_from_filename(upload_file.filename)
            )
            pending_documents.append(
                {
                    "title": doc_title,
                    "file_type": _file_type(upload_file.filename),
                    "storage_path": storage_path,
                    "uploader_id": uploader_id,
                    "category_id": category_id,
                }
            )
        created_docs = create_documents(pending_documents)
    except UploadRejectedError as exc:
        for saved_path in saved_paths:
            delete_upload(saved_path)
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception:
        for saved_path in saved_paths:
            delete_upload(saved_path)
        raise

    responses = [DocumentResponse.from_orm_obj(doc) for doc in created_docs]
    if len(responses) == 1 and file is not None and not files:
        return responses[0]
    return DocumentUploadResponse(items=responses)


@router.get("")
def get_documents(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    category_id: int | None = Query(None),
    review_status: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> DocumentListResponse:
    """按可选条件筛选并列出文档。"""
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


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: int,
    _current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> DocumentResponse:
    """根据 ID 获取单个文档。"""
    doc = get_document_by_id(document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return DocumentResponse.from_orm_obj(doc)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_document(
    document_id: int,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    """删除文档及其块（级联删除），仅管理员可用。"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可删除文档",
        )
    ok = delete_document(document_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")

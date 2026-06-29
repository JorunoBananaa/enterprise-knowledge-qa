from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_admin
from app.repositories.categories import (
    count_documents_in_category,
    create_category,
    delete_category,
    get_category_by_id,
    get_category_by_name,
    list_categories,
    update_category,
)
from app.schemas.auth import CurrentUser
from app.schemas.category import (
    CategoryCreate,
    CategoryListResponse,
    CategoryResponse,
    CategoryUpdate,
)

router = APIRouter()


@router.get("", response_model=CategoryListResponse)
def get_categories(
    _current_user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CategoryListResponse:
    """列出所有分类（所有登录用户可访问）。"""
    cats = list_categories(db)
    return CategoryListResponse(
        items=[
            CategoryResponse.from_orm_obj(
                c, documents_count=count_documents_in_category(db, c.id)
            )
            for c in cats
        ],
    )


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category_route(
    payload: CategoryCreate,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> CategoryResponse:
    """创建分类（仅管理员）。"""
    if get_category_by_name(db, payload.name) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="分类名称已存在"
        )
    if payload.parent_id is not None:
        parent = get_category_by_id(db, payload.parent_id)
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="父分类不存在"
            )
    cat = create_category(db, name=payload.name, parent_id=payload.parent_id)
    return CategoryResponse.from_orm_obj(cat)


@router.patch("/{category_id}", response_model=CategoryResponse)
def update_category_route(
    category_id: int,
    payload: CategoryUpdate,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> CategoryResponse:
    """更新分类（仅管理员）。"""
    cat = get_category_by_id(db, category_id)
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分类不存在")

    if payload.name is not None and payload.name != cat.name:
        if get_category_by_name(db, payload.name) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="分类名称已存在"
            )

    if payload.parent_id is not None:
        if payload.parent_id == category_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="不能将分类设为自身的子分类"
            )
        parent = get_category_by_id(db, payload.parent_id)
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="父分类不存在"
            )

    cat = update_category(
        db,
        cat,
        name=payload.name if payload.name is not None else None,
        parent_id=payload.parent_id if payload.parent_id is not None else None,
    )
    return CategoryResponse.from_orm_obj(cat)


@router.delete("/{category_id}", status_code=status.HTTP_200_OK)
def delete_category_route(
    category_id: int,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    """删除分类（仅管理员）。会级联删除所有子分类及下属全部文档。"""
    cat = get_category_by_id(db, category_id)
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分类不存在")

    doc_count = count_documents_in_category(db, category_id)

    delete_category(db, cat)
    return {"message": f"分类已删除，同时删除了 {doc_count} 篇关联文档"}

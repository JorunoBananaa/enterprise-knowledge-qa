from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, require_admin
from app.repositories.prompts import (
    activate_prompt,
    create_system_prompt,
    get_user_prompt,
    list_system_prompts,
    upsert_user_prompt,
)
from app.schemas.prompt import (
    SystemPromptCreate,
    SystemPromptResponse,
    UserPromptResponse,
    UserPromptUpdate,
)

router = APIRouter()


@router.get("/system")
def get_system_prompts(
    _admin: Annotated[dict[str, str], Depends(require_admin)],
) -> list[SystemPromptResponse]:
    """List all system prompt versions (admin only)."""
    prompts = list_system_prompts()
    return [SystemPromptResponse.from_orm_obj(p) for p in prompts]


@router.post("/system", status_code=status.HTTP_201_CREATED)
def create_prompt(
    payload: SystemPromptCreate,
    admin: Annotated[dict[str, str], Depends(require_admin)],
) -> SystemPromptResponse:
    """Create a new system prompt version (admin only)."""
    author_id = 1  # admin is user ID 1 in MVP
    pt = create_system_prompt(content=payload.content, author_id=author_id)
    return SystemPromptResponse.from_orm_obj(pt)


@router.post("/system/{version}/activate")
def activate_system_prompt(
    version: int,
    _admin: Annotated[dict[str, str], Depends(require_admin)],
) -> SystemPromptResponse:
    """Activate a system prompt version (admin only)."""
    pt = activate_prompt(version)
    if pt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prompt version not found")
    return SystemPromptResponse.from_orm_obj(pt)


@router.get("/me")
def get_my_prompt(
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
) -> UserPromptResponse | dict[str, str]:
    """Get the current user's personal prompt."""
    user_id = 1 if current_user["sub"] == "admin" else 2
    up = get_user_prompt(user_id)
    if up is None:
        return {"content": "", "enabled": True}
    return UserPromptResponse.from_orm_obj(up)


@router.put("/me")
def update_my_prompt(
    payload: UserPromptUpdate,
    current_user: Annotated[dict[str, str], Depends(get_current_user)],
) -> UserPromptResponse:
    """Update the current user's personal prompt."""
    user_id = 1 if current_user["sub"] == "admin" else 2
    up = upsert_user_prompt(user_id=user_id, content=payload.content, enabled=payload.enabled)
    return UserPromptResponse.from_orm_obj(up)

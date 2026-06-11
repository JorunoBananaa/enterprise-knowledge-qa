from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, require_admin
from app.schemas.auth import CurrentUser
from app.repositories.prompts import (
    get_system_prompt_content,
    get_user_prompt,
    upsert_system_prompt,
    upsert_user_prompt,
)
from app.schemas.prompt import (
    SystemPromptResponse,
    SystemPromptUpdate,
    UserPromptResponse,
    UserPromptUpdate,
)

router = APIRouter()


@router.get("/system")
def get_system_prompt(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> SystemPromptResponse:
    """Get current system prompt content (admin only)."""
    return SystemPromptResponse(content=get_system_prompt_content())


@router.put("/system")
def update_system_prompt(
    payload: SystemPromptUpdate,
    admin: Annotated[CurrentUser, Depends(require_admin)],
) -> SystemPromptResponse:
    """Update system prompt content (admin only)."""
    upsert_system_prompt(content=payload.content, author_id=admin.id)
    return SystemPromptResponse(content=payload.content)


@router.get("/me")
def get_my_prompt(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> UserPromptResponse:
    """Get the current user's personal prompt."""
    return UserPromptResponse(content=get_user_prompt(current_user.id))


@router.put("/me")
def update_my_prompt(
    payload: UserPromptUpdate,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> UserPromptResponse:
    """Update the current user's personal prompt."""
    upsert_user_prompt(user_id=current_user.id, content=payload.content)
    return UserPromptResponse(content=payload.content)

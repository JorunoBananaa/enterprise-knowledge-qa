from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.messages import HumanMessage

from app.api.deps import get_current_user, require_admin
from app.repositories.llm_config import (
    create_llm_config,
    delete_llm_config,
    get_llm_config,
    list_llm_configs,
    set_active_llm_config,
    update_llm_config,
)
from app.schemas.auth import CurrentUser
from app.schemas.llm_config import (
    LLMConfigBrief,
    LLMConfigCreate,
    LLMConfigResponse,
    LLMConfigUpdate,
)
from app.services.llm_factory import create_chat_model

router = APIRouter()


# ── List all configs (admin only) ─────────────────────────────────────

@router.get("", response_model=list[LLMConfigResponse])
def list_configs(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> list[LLMConfigResponse]:
    configs = list_llm_configs()
    return [LLMConfigResponse.from_orm_obj(c) for c in configs]


# ── List brief configs (any authenticated user – for dropdown) ────────

@router.get("/brief", response_model=list[LLMConfigBrief])
def list_configs_brief(
    _current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[LLMConfigBrief]:
    configs = list_llm_configs()
    return [LLMConfigBrief.from_orm_obj(c) for c in configs]


# ── Create ────────────────────────────────────────────────────────────

@router.post("", response_model=LLMConfigResponse, status_code=status.HTTP_201_CREATED)
def create(
    payload: LLMConfigCreate,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> LLMConfigResponse:
    cfg = create_llm_config(
        name=payload.name,
        provider=payload.provider,
        model_name=payload.model_name,
        api_key=payload.api_key,
        base_url=payload.base_url,
    )
    return LLMConfigResponse.from_orm_obj(cfg)


# ── Update ────────────────────────────────────────────────────────────

@router.patch("/{config_id}", response_model=LLMConfigResponse)
def update(
    config_id: int,
    payload: LLMConfigUpdate,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> LLMConfigResponse:
    # Snapshot current values for partial update
    current = get_llm_config(config_id)
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="配置不存在")

    updates = payload.model_dump(exclude_unset=True)
    cfg = update_llm_config(config_id, **updates)
    if cfg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="配置不存在")
    return LLMConfigResponse.from_orm_obj(cfg)


# ── Activate ──────────────────────────────────────────────────────────

@router.post("/{config_id}/activate", response_model=LLMConfigResponse)
def activate(
    config_id: int,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> LLMConfigResponse:
    cfg = set_active_llm_config(config_id)
    if cfg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="配置不存在")
    return LLMConfigResponse.from_orm_obj(cfg)


# ── Test connectivity ─────────────────────────────────────────────────

@router.post("/{config_id}/test")
def test_connectivity(
    config_id: int,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> dict:
    """Send a minimal ping to verify the LLM API is reachable and the key works."""
    cfg = get_llm_config(config_id)
    if cfg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="配置不存在")

    try:
        model = create_chat_model(
            provider=cfg.provider,
            model_name=cfg.model_name,
            api_key=cfg.api_key,
            base_url=cfg.base_url,
            temperature=0.0,
        )
        model.invoke([HumanMessage(content="ping")])
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="连通性测试失败",
        )

    return {"ok": True, "message": "连通性正常"}


# ── Delete ────────────────────────────────────────────────────────────

@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(
    config_id: int,
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> None:
    ok = delete_llm_config(config_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="配置不存在")

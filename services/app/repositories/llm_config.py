from __future__ import annotations

from app.db.session import SessionLocal
from app.models.llm_config import LLMConfig


def list_llm_configs() -> list[LLMConfig]:
    db = SessionLocal()
    try:
        return db.query(LLMConfig).order_by(LLMConfig.created_at.desc()).all()
    finally:
        db.close()


def get_llm_config(config_id: int) -> LLMConfig | None:
    db = SessionLocal()
    try:
        return db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    finally:
        db.close()


def get_active_llm_config() -> LLMConfig | None:
    db = SessionLocal()
    try:
        return db.query(LLMConfig).filter(LLMConfig.is_active == True).first()  # noqa: E712
    finally:
        db.close()


def create_llm_config(
    name: str,
    provider: str,
    model_name: str,
    api_key: str,
    base_url: str | None,
) -> LLMConfig:
    db = SessionLocal()
    try:
        cfg = LLMConfig(
            name=name,
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
        return cfg
    finally:
        db.close()


def update_llm_config(config_id: int, **kwargs) -> LLMConfig | None:
    db = SessionLocal()
    try:
        cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
        if cfg is None:
            return None
        for key, value in kwargs.items():
            if value is not None and hasattr(cfg, key):
                setattr(cfg, key, value)
        db.commit()
        db.refresh(cfg)
        return cfg
    finally:
        db.close()


def delete_llm_config(config_id: int) -> bool:
    db = SessionLocal()
    try:
        cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
        if cfg is None:
            return False
        db.delete(cfg)
        db.commit()
        return True
    finally:
        db.close()


def set_active_llm_config(config_id: int) -> LLMConfig | None:
    """激活一个配置，并停用其他所有配置。"""
    db = SessionLocal()
    try:
        # 停用全部配置
        db.query(LLMConfig).update({"is_active": False})
        # 激活目标配置
        cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
        if cfg is None:
            db.rollback()
            return None
        cfg.is_active = True
        db.commit()
        db.refresh(cfg)
        return cfg
    finally:
        db.close()

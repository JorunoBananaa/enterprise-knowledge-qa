from __future__ import annotations

"""
LLM 工厂 —— 从 LLMConfig 记录创建 LangChain 聊天模型实例。

支持的提供商：
- deepseek   → ChatOpenAI（OpenAI 兼容，base_url=https://api.deepseek.com/v1）
- openai     → ChatOpenAI
- anthropic  → ChatAnthropic（预留）
- zhipu      → ChatOpenAI（OpenAI 兼容，base_url=https://open.bigmodel.cn/api/paas/v4/）
- qwen       → ChatOpenAI（OpenAI 兼容，通过 DashScope）
- moonshot   → ChatOpenAI（OpenAI 兼容，base_url=https://api.moonshot.cn/v1）

扩展新提供商：
1. 在下方添加提供商键和映射。
2. 若非 OpenAI 兼容，添加对应的 LangChain 聊天模型类。
"""

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel


# ── 提供商 → (ChatModel 类, 默认 base_url) ────────────────────

_PROVIDER_REGISTRY: dict[str, tuple[str, str | None]] = {
    "deepseek":  ("ChatOpenAI", "https://api.deepseek.com/v1"),
    "openai":    ("ChatOpenAI", None),                       # 使用环境变量 OPENAI_API_KEY / 默认 base
    "anthropic": ("ChatAnthropic", None),
    "zhipu":     ("ChatOpenAI", "https://open.bigmodel.cn/api/paas/v4/"),
    "qwen":      ("ChatOpenAI", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    "moonshot":  ("ChatOpenAI", "https://api.moonshot.cn/v1"),
}

SUPPORTED_PROVIDERS = sorted(_PROVIDER_REGISTRY.keys())


def _resolve_model_kwargs(
    provider: str,
    model_name: str,
    api_key: str,
    base_url: str | None,
) -> dict[str, Any]:
    """构建 LangChain 聊天模型构造函数的 kwargs。"""
    if provider not in _PROVIDER_REGISTRY:
        raise ValueError(f"Unsupported LLM provider: {provider}. Supported: {SUPPORTED_PROVIDERS}")

    cls_name, default_base = _PROVIDER_REGISTRY[provider]
    kwargs: dict[str, Any] = {
        "model": model_name,
        "api_key": api_key,
    }
    if cls_name == "ChatOpenAI":
        # ChatOpenAI 使用 openai_api_key 而非 api_key
        kwargs = {
            "model": model_name,
            "openai_api_key": api_key,
        }
        resolved_base = base_url or default_base
        if resolved_base:
            kwargs["base_url"] = resolved_base
    elif cls_name == "ChatAnthropic":
        kwargs = {
            "model": model_name,
            "anthropic_api_key": api_key,
        }
        if base_url:
            kwargs["base_url"] = base_url

    return kwargs


def create_chat_model(
    provider: str,
    model_name: str,
    api_key: str,
    base_url: str | None = None,
    temperature: float = 0.0,
) -> BaseChatModel:
    """Create a LangChain chat model instance from provider configuration.

    Args:
        provider:  One of SUPPORTED_PROVIDERS (e.g. "deepseek", "openai").
        model_name: Model identifier (e.g. "deepseek-chat", "gpt-4o").
        api_key:    API key or token.
        base_url:   Override the default base URL (optional).
        temperature: Sampling temperature (0 = deterministic).

    Returns:
        A LangChain BaseChatModel instance ready for `.invoke()`.
    """
    if provider not in _PROVIDER_REGISTRY:
        raise ValueError(f"Unsupported LLM provider: {provider}. Supported: {SUPPORTED_PROVIDERS}")

    cls_name, default_base = _PROVIDER_REGISTRY[provider]
    kwargs = _resolve_model_kwargs(provider, model_name, api_key, base_url)

    if cls_name == "ChatOpenAI":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(temperature=temperature, streaming=True, **kwargs)
    elif cls_name == "ChatAnthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(temperature=temperature, streaming=True, **kwargs)
    else:
        raise ValueError(f"Unknown model class: {cls_name}")

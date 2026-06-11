from __future__ import annotations

"""
LLM Factory – creates LangChain chat model instances from LLMConfig records.

Supported providers:
- deepseek   → ChatOpenAI (OpenAI-compatible, base_url=https://api.deepseek.com/v1)
- openai     → ChatOpenAI
- anthropic  → ChatAnthropic (reserved for future)
- zhipu      → ChatOpenAI (OpenAI-compatible, base_url=https://open.bigmodel.cn/api/paas/v4/)
- qwen       → ChatOpenAI (OpenAI-compatible, via DashScope)
- moonshot   → ChatOpenAI (OpenAI-compatible, base_url=https://api.moonshot.cn/v1)

Extending to a new provider:
1. Add the provider key and mapping below.
2. If not OpenAI-compatible, add the appropriate LangChain chat model class.
"""

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel


# ── Provider → (ChatModel class, default_base_url) ────────────────────

_PROVIDER_REGISTRY: dict[str, tuple[str, str | None]] = {
    "deepseek":  ("ChatOpenAI", "https://api.deepseek.com/v1"),
    "openai":    ("ChatOpenAI", None),                       # uses env OPENAI_API_KEY / default base
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
    """Build kwargs for the LangChain chat model constructor."""
    if provider not in _PROVIDER_REGISTRY:
        raise ValueError(f"Unsupported LLM provider: {provider}. Supported: {SUPPORTED_PROVIDERS}")

    cls_name, default_base = _PROVIDER_REGISTRY[provider]
    kwargs: dict[str, Any] = {
        "model": model_name,
        "api_key": api_key,
    }
    if cls_name == "ChatOpenAI":
        # ChatOpenAI uses openai_api_key, not api_key
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
        return ChatOpenAI(temperature=temperature, **kwargs)
    elif cls_name == "ChatAnthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(temperature=temperature, **kwargs)
    else:
        raise ValueError(f"Unknown model class: {cls_name}")

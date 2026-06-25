"""
Embedding Factory – creates LangChain embedding model instances.

Supported providers:
- openai      → OpenAIEmbeddings
- deepseek    → OpenAIEmbeddings (OpenAI-compatible, base_url=https://api.deepseek.com/v1)
- zhipu       → OpenAIEmbeddings (OpenAI-compatible, base_url=https://open.bigmodel.cn/api/paas/v4/)
- qwen        → OpenAIEmbeddings (OpenAI-compatible, via DashScope)
- huggingface → HuggingFaceEmbeddings (local, no API key needed)
"""

import threading
from typing import Any

from langchain_core.embeddings import Embeddings

# ── Provider → (Embeddings class, default_base_url) ──────────────────

_EMBEDDING_REGISTRY: dict[str, tuple[str, str | None]] = {
    "openai":      ("OpenAIEmbeddings", None),
    "deepseek":    ("OpenAIEmbeddings", "https://api.deepseek.com/v1"),
    "zhipu":       ("OpenAIEmbeddings", "https://open.bigmodel.cn/api/paas/v4/"),
    "qwen":        ("OpenAIEmbeddings", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    "huggingface": ("HuggingFaceEmbeddings", None),
}

SUPPORTED_EMBEDDING_PROVIDERS = sorted(_EMBEDDING_REGISTRY.keys())

# Module-level cache for Embeddings instances.
#
# HuggingFaceEmbeddings loads model weights into memory on construction,
# which can take several seconds. Constructing a fresh instance on every
# request blocks the event loop (ask_question_stream is an async def) and
# starves concurrent requests such as POST /sessions. Caching the instance
# per (provider, model_name, api_key, base_url) avoids the repeated reload.
_EMBEDDING_CACHE: dict[str, Embeddings] = {}
_EMBEDDING_CACHE_LOCK = threading.Lock()


def _instantiate_embeddings(
    provider: str,
    model_name: str,
    api_key: str,
    base_url: str | None,
) -> Embeddings:
    """Create a brand-new Embeddings instance (slow: may load model weights)."""
    cls_name, default_base = _EMBEDDING_REGISTRY[provider]
    resolved_base = base_url or default_base

    if cls_name == "OpenAIEmbeddings":
        from langchain_openai import OpenAIEmbeddings

        kwargs: dict[str, Any] = {
            "model": model_name,
            "openai_api_key": api_key,
        }
        if resolved_base:
            kwargs["base_url"] = resolved_base
        return OpenAIEmbeddings(**kwargs)

    if cls_name == "HuggingFaceEmbeddings":
        from langchain_huggingface import HuggingFaceEmbeddings

        return HuggingFaceEmbeddings(
            model_name=model_name,
            encode_kwargs={"normalize_embeddings": True},
        )

    raise ValueError(f"Unknown embedding class: {cls_name}")


def create_embeddings(
    provider: str,
    model_name: str,
    api_key: str = "",
    base_url: str | None = None,
) -> Embeddings:
    """Create (or reuse a cached) LangChain Embeddings instance.

    Args:
        provider:   One of SUPPORTED_EMBEDDING_PROVIDERS.
        model_name: Embedding model identifier (e.g. "text-embedding-ada-002" for OpenAI,
                    "sentence-transformers/all-mpnet-base-v2" for HuggingFace).
        api_key:    API key or token (not needed for huggingface).
        base_url:   Override the default base URL.

    Returns:
        A LangChain Embeddings instance.
    """
    if provider not in _EMBEDDING_REGISTRY:
        raise ValueError(
            f"Unsupported embedding provider: {provider}. "
            f"Supported: {SUPPORTED_EMBEDDING_PROVIDERS}"
        )

    cache_key = f"{provider}:{model_name}:{api_key}:{base_url or ''}"

    # Fast path: return cached instance without acquiring the lock.
    cached = _EMBEDDING_CACHE.get(cache_key)
    if cached is not None:
        return cached

    # Slow path: instantiate (may take seconds) under a lock so we don't
    # build duplicate instances for the same key concurrently.
    with _EMBEDDING_CACHE_LOCK:
        cached = _EMBEDDING_CACHE.get(cache_key)
        if cached is not None:
            return cached

        instance = _instantiate_embeddings(provider, model_name, api_key, base_url)
        _EMBEDDING_CACHE[cache_key] = instance
        return instance

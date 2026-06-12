"""
Embedding Factory – creates LangChain embedding model instances.

Supported providers:
- openai      → OpenAIEmbeddings
- deepseek    → OpenAIEmbeddings (OpenAI-compatible, base_url=https://api.deepseek.com/v1)
- zhipu       → OpenAIEmbeddings (OpenAI-compatible, base_url=https://open.bigmodel.cn/api/paas/v4/)
- qwen        → OpenAIEmbeddings (OpenAI-compatible, via DashScope)
- huggingface → HuggingFaceEmbeddings (local, no API key needed)
"""

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


def create_embeddings(
    provider: str,
    model_name: str,
    api_key: str = "",
    base_url: str | None = None,
) -> Embeddings:
    """Create a LangChain Embeddings instance.

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

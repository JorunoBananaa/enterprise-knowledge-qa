"""
Embedding 工厂 —— 创建 LangChain embedding 模型实例。

支持的提供商：
- openai      → OpenAIEmbeddings
- deepseek    → OpenAIEmbeddings（OpenAI 兼容，base_url=https://api.deepseek.com/v1）
- zhipu       → OpenAIEmbeddings（OpenAI 兼容，base_url=https://open.bigmodel.cn/api/paas/v4/）
- qwen        → OpenAIEmbeddings（OpenAI 兼容，通过 DashScope）
- huggingface → HuggingFaceEmbeddings（本地运行，无需 API key）
- ollama      → OpenAIEmbeddings（OpenAI 兼容，本地 Ollama，base_url=http://localhost:11434/v1）
"""

import threading
from typing import Any

from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings

from app.core.url_security import validate_model_base_url


class _OllamaEmbeddings(OpenAIEmbeddings):
    """适配 Ollama 单字符串 /v1/embeddings 的 OpenAIEmbeddings 包装类。

    Ollama 只接受 ``{"input": "a single string"}``；标准
    OpenAIEmbeddings.embed_documents() 会发送 JSON 数组，并因
    "invalid input type" 失败。该子类会为每段文本分别发送一次请求。
    """

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [
            self.client.create(input=t, model=self.model).data[0].embedding
            for t in texts
        ]

# ── 提供商 → (Embeddings 类, 默认 base_url) ──────────────────

_EMBEDDING_REGISTRY: dict[str, tuple[str, str | None]] = {
    "openai":      ("OpenAIEmbeddings", None),
    "deepseek":    ("OpenAIEmbeddings", "https://api.deepseek.com/v1"),
    "zhipu":       ("OpenAIEmbeddings", "https://open.bigmodel.cn/api/paas/v4/"),
    "qwen":        ("OpenAIEmbeddings", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    "huggingface": ("HuggingFaceEmbeddings", None),
    "ollama":      ("OpenAIEmbeddings", "http://localhost:11434/v1"),
}

SUPPORTED_EMBEDDING_PROVIDERS = sorted(_EMBEDDING_REGISTRY.keys())

# Embeddings 实例的模块级缓存。
#
# HuggingFaceEmbeddings 在构造时会把模型权重加载到内存中，
# 这个过程可能耗时数秒。每次请求都创建新实例会阻塞事件循环
#（ask_question_stream 是 async def），导致 POST /sessions 等并发请求
# 得不到调度。按 (provider, model_name, api_key, base_url) 缓存实例可避免重复加载。
_EMBEDDING_CACHE: dict[str, Embeddings] = {}
_EMBEDDING_CACHE_LOCK = threading.Lock()


def _instantiate_embeddings(
    provider: str,
    model_name: str,
    api_key: str,
    base_url: str | None,
) -> Embeddings:
    """创建全新的 Embeddings 实例（较慢，可能加载模型权重）。"""
    cls_name, default_base = _EMBEDDING_REGISTRY[provider]
    resolved_base = validate_model_base_url(provider, base_url or default_base)

    if cls_name == "OpenAIEmbeddings":
        # Ollama 本地运行且不需要 API key，但 OpenAI 客户端拒绝空字符串，
        # 因此提供一个占位值。
        resolved_api_key = api_key or ("ollama" if provider == "ollama" else "")

        kwargs: dict[str, Any] = {
            "model": model_name,
            "openai_api_key": resolved_api_key,
        }
        if resolved_base:
            kwargs["base_url"] = resolved_base

        # Ollama /v1/embeddings 只接受单字符串输入。
        # _OllamaEmbeddings 覆盖 embed_documents()，逐条批处理。
        if provider == "ollama":
            return _OllamaEmbeddings(**kwargs)

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
    """创建或复用缓存的 LangChain Embeddings 实例。

    参数：
        provider: SUPPORTED_EMBEDDING_PROVIDERS 中的提供商键。
        model_name: Embedding 模型标识，例如 OpenAI 的 "text-embedding-ada-002"，
                    或 HuggingFace 的 "sentence-transformers/all-mpnet-base-v2"。
        api_key: API key 或 token（huggingface 不需要）。
        base_url: 覆盖默认 base URL。

    返回：
        LangChain Embeddings 实例。
    """
    if provider not in _EMBEDDING_REGISTRY:
        raise ValueError(
            f"Unsupported embedding provider: {provider}. "
            f"Supported: {SUPPORTED_EMBEDDING_PROVIDERS}"
        )

    cache_key = f"{provider}:{model_name}:{api_key}:{base_url or ''}"

    # 快路径：不获取锁，直接返回缓存实例。
    cached = _EMBEDDING_CACHE.get(cache_key)
    if cached is not None:
        return cached

    # 慢路径：在锁内实例化（可能耗时数秒），避免并发为同一个 key 构造重复实例。
    with _EMBEDDING_CACHE_LOCK:
        cached = _EMBEDDING_CACHE.get(cache_key)
        if cached is not None:
            return cached

        instance = _instantiate_embeddings(provider, model_name, api_key, base_url)
        _EMBEDDING_CACHE[cache_key] = instance
        return instance

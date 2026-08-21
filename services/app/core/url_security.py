from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from app.core.config import settings


_KNOWN_PROVIDER_BASE_URLS: dict[str, set[str]] = {
    "deepseek": {"https://api.deepseek.com/v1"},
    "zhipu": {"https://open.bigmodel.cn/api/paas/v4"},
    "qwen": {"https://dashscope.aliyuncs.com/compatible-mode/v1"},
    "moonshot": {"https://api.moonshot.cn/v1"},
}


def _canonical_base_url(value: str) -> str:
    raw = value.strip()
    if not raw:
        raise ValueError("模型服务地址不能为空")

    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("模型服务地址必须是有效的 HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("模型服务地址不能包含用户名或密码")
    if parsed.query or parsed.fragment:
        raise ValueError("模型服务地址不能包含查询参数或 fragment")

    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("模型服务地址端口无效") from exc

    host = parsed.hostname.lower()
    host_for_netloc = f"[{host}]" if ":" in host else host
    if port is not None and not (
        (parsed.scheme == "https" and port == 443)
        or (parsed.scheme == "http" and port == 80)
    ):
        host_for_netloc = f"{host_for_netloc}:{port}"

    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, host_for_netloc, path, "", ""))


def _configured_allowlist() -> set[str]:
    values = {
        item.strip()
        for item in settings.model_base_url_allowlist.split(",")
        if item.strip()
    }
    if settings.ollama_base_url.strip():
        values.add(settings.ollama_base_url)
    return {_canonical_base_url(item) for item in values}


def validate_model_base_url(provider: str, base_url: str | None) -> str | None:
    """只允许内置提供商地址或部署者显式配置的模型服务地址。"""
    if base_url is None:
        return None

    canonical = _canonical_base_url(base_url)
    allowed = {
        _canonical_base_url(item)
        for item in _KNOWN_PROVIDER_BASE_URLS.get(provider.lower(), set())
    }
    allowed.update(_configured_allowlist())
    if canonical not in allowed:
        raise ValueError(
            "模型服务地址不在允许列表中；请使用内置提供商地址或配置 MODEL_BASE_URL_ALLOWLIST"
        )
    return canonical

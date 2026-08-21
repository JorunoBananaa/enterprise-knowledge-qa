import json
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

from app.core.config import settings


JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
MODEL = "PaddleOCR-VL-1.6"

DEFAULT_OPTIONAL_PAYLOAD = {
    "useDocOrientationClassify": False,
    "useDocUnwarping": False,
    "useChartRecognition": False,
}


def recognize_text(
    path: str,
    *,
    token: str | None = None,
    model: str = MODEL,
    optional_payload: dict | None = None,
    poll_interval: float = 5,
) -> str:
    """从本地文件路径或 URL 识别 OCR 文本。"""
    resolved_token = token or settings.paddleocr_token
    if not resolved_token:
        raise RuntimeError("OCR 未配置：请通过 PADDLEOCR_TOKEN 注入有效 Token")

    headers = {"Authorization": f"bearer {resolved_token}"}
    payload_options = DEFAULT_OPTIONAL_PAYLOAD if optional_payload is None else optional_payload

    job_id = _submit_job(path, headers, model, payload_options)
    jsonl_url = _wait_for_result_url(job_id, headers, poll_interval)
    return _download_markdown_text(jsonl_url)


def _submit_job(path: str, headers: dict[str, str], model: str, optional_payload: dict) -> str:
    if path.startswith(("http://", "https://")):
        response = requests.post(
            JOB_URL,
            json={"fileUrl": path, "model": model, "optionalPayload": optional_payload},
            headers={**headers, "Content-Type": "application/json"},
            timeout=settings.paddleocr_http_timeout_seconds,
            allow_redirects=False,
        )
    else:
        file_path = Path(path)
        if not file_path.exists():
            raise FileNotFoundError(path)

        with file_path.open("rb") as file_obj:
            response = requests.post(
                JOB_URL,
                headers=headers,
                data={"model": model, "optionalPayload": json.dumps(optional_payload)},
                files={"file": file_obj},
                timeout=settings.paddleocr_http_timeout_seconds,
                allow_redirects=False,
            )

    _raise_for_bad_response(response)
    return response.json()["data"]["jobId"]


def _wait_for_result_url(job_id: str, headers: dict[str, str], poll_interval: float) -> str:
    deadline = time.monotonic() + settings.paddleocr_max_wait_seconds
    while True:
        if time.monotonic() >= deadline:
            raise TimeoutError("OCR job timed out")

        response = requests.get(
            f"{JOB_URL}/{job_id}",
            headers=headers,
            timeout=settings.paddleocr_http_timeout_seconds,
            allow_redirects=False,
        )
        _raise_for_bad_response(response)

        data = response.json()["data"]
        state = data["state"]
        if state == "done":
            return data["resultUrl"]["jsonUrl"]
        if state == "failed":
            raise RuntimeError(data.get("errorMsg", "OCR job failed"))
        if state not in {"pending", "running"}:
            raise RuntimeError(f"Unexpected OCR job state: {state}")

        time.sleep(poll_interval)


def _download_markdown_text(jsonl_url: str) -> str:
    _validate_result_url(jsonl_url)
    response = requests.get(
        jsonl_url,
        timeout=settings.paddleocr_http_timeout_seconds,
        allow_redirects=False,
        stream=True,
    )
    _raise_for_bad_response(response)

    payload = bytearray()
    for chunk in response.iter_content(chunk_size=64 * 1024):
        payload.extend(chunk)
        if len(payload) > settings.paddleocr_max_result_bytes:
            raise RuntimeError("OCR result exceeds configured size limit")

    pages: list[str] = []
    for line in payload.decode("utf-8-sig").splitlines():
        if not line.strip():
            continue

        result = json.loads(line)["result"]
        for item in result.get("layoutParsingResults", []):
            text = item.get("markdown", {}).get("text", "").strip()
            if text:
                pages.append(text)

    return "\n\n".join(pages)


def _raise_for_bad_response(response: requests.Response) -> None:
    if response.status_code != 200:
        raise RuntimeError(f"OCR request failed with status {response.status_code}")


def _validate_result_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("OCR result URL is not an allowed HTTPS URL")
    if parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError("OCR result URL contains forbidden URL components")

    allowed_hosts = {
        item.strip().lower().rstrip(".")
        for item in settings.paddleocr_result_host_allowlist.split(",")
        if item.strip()
    }
    job_host = urlsplit(JOB_URL).hostname
    if job_host:
        allowed_hosts.add(job_host.lower().rstrip("."))
    if parsed.hostname.lower().rstrip(".") not in allowed_hosts:
        raise RuntimeError("OCR result URL host is not allowlisted")

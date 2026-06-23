import json
import os
import time
from pathlib import Path

import requests


JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
TOKEN = "bb44a549ccbca2065e7551306cef4e20f6730635"
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
    """Recognize OCR text from a local file path or URL."""
    headers = {"Authorization": f"bearer {token or os.getenv('PADDLEOCR_TOKEN', TOKEN)}"}
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
            )

    _raise_for_bad_response(response)
    return response.json()["data"]["jobId"]


def _wait_for_result_url(job_id: str, headers: dict[str, str], poll_interval: float) -> str:
    while True:
        response = requests.get(f"{JOB_URL}/{job_id}", headers=headers)
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
    response = requests.get(jsonl_url)
    _raise_for_bad_response(response)

    pages: list[str] = []
    for line in response.text.splitlines():
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
        raise RuntimeError(f"OCR request failed with status {response.status_code}: {response.text}")

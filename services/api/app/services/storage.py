import logging
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings

logger = logging.getLogger(__name__)


def save_upload(file: UploadFile) -> str:
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix
    target = upload_dir / f"{uuid4().hex}{suffix}"
    with target.open("wb") as handle:
        handle.write(file.file.read())
    return str(target)


def delete_upload(file_path: str) -> None:
    """从磁盘删除已上传文件；文件不存在时静默忽略。"""
    try:
        p = Path(file_path)
        if p.exists():
            p.unlink()
    except OSError:
        logger.warning("Failed to delete uploaded file: %s", file_path, exc_info=True)

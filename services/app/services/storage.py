import codecs
import logging
import zipfile
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings

logger = logging.getLogger(__name__)

_COPY_CHUNK_SIZE = 1024 * 1024
_GENERIC_BINARY_MIME = "application/octet-stream"
_ALLOWED_MIME_TYPES: dict[str, set[str]] = {
    ".pdf": {"application/pdf", _GENERIC_BINARY_MIME},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _GENERIC_BINARY_MIME,
    },
    ".pptx": {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _GENERIC_BINARY_MIME,
    },
    ".xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _GENERIC_BINARY_MIME,
    },
    ".txt": {"text/plain", _GENERIC_BINARY_MIME},
    ".md": {"text/markdown", "text/plain", _GENERIC_BINARY_MIME},
    ".csv": {"text/csv", "application/csv", "text/plain", _GENERIC_BINARY_MIME},
}
_OFFICE_PREFIXES = {
    ".docx": "word/",
    ".pptx": "ppt/",
    ".xlsx": "xl/",
}


class UploadRejectedError(ValueError):
    def __init__(self, detail: str, *, status_code: int = 415) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def save_upload(file: UploadFile) -> str:
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "").suffix.lower()
    allowed_extensions = {
        item.strip().lower()
        for item in settings.upload_allowed_extensions.split(",")
        if item.strip()
    }
    if suffix not in allowed_extensions or suffix not in _ALLOWED_MIME_TYPES:
        raise UploadRejectedError("不支持的文件类型")

    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in _ALLOWED_MIME_TYPES[suffix]:
        raise UploadRejectedError("文件扩展名与 Content-Type 不匹配")

    target = upload_dir / f"{uuid4().hex}{suffix}"
    temporary = upload_dir / f".{target.name}.uploading"

    try:
        total = 0
        with temporary.open("xb") as handle:
            while chunk := file.file.read(_COPY_CHUNK_SIZE):
                total += len(chunk)
                if total > settings.upload_max_file_size_bytes:
                    raise UploadRejectedError("文件大小超过限制", status_code=413)
                handle.write(chunk)

        if total == 0:
            raise UploadRejectedError("不能上传空文件", status_code=422)

        _validate_file_content(temporary, suffix)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise

    return str(target)


def _validate_file_content(path: Path, suffix: str) -> None:
    if suffix == ".pdf":
        with path.open("rb") as handle:
            if handle.read(5) != b"%PDF-":
                raise UploadRejectedError("PDF 文件签名无效")
        return

    if suffix in _OFFICE_PREFIXES:
        _validate_office_archive(path, suffix)
        return

    _validate_utf8_text(path)


def _validate_office_archive(path: Path, suffix: str) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > settings.upload_max_archive_entries:
                raise UploadRejectedError("Office 文件包含过多压缩条目")

            total_uncompressed = 0
            names: set[str] = set()
            for info in infos:
                names.add(info.filename.replace("\\", "/"))
                total_uncompressed += info.file_size
                if total_uncompressed > settings.upload_max_archive_uncompressed_bytes:
                    raise UploadRejectedError("Office 文件解压后大小超过限制")
                if info.file_size and (
                    info.compress_size == 0
                    or info.file_size
                    > info.compress_size * settings.upload_max_archive_compression_ratio
                ):
                    raise UploadRejectedError("Office 文件压缩比异常")

            if "[Content_Types].xml" not in names or not any(
                name.startswith(_OFFICE_PREFIXES[suffix]) for name in names
            ):
                raise UploadRejectedError("Office 文件结构与扩展名不匹配")
    except zipfile.BadZipFile as exc:
        raise UploadRejectedError("Office 文件不是有效的 ZIP 容器") from exc


def _validate_utf8_text(path: Path) -> None:
    decoder = codecs.getincrementaldecoder("utf-8")()
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(_COPY_CHUNK_SIZE):
                if b"\x00" in chunk:
                    raise UploadRejectedError("文本文件包含二进制内容")
                decoder.decode(chunk)
        decoder.decode(b"", final=True)
    except UnicodeDecodeError as exc:
        raise UploadRejectedError("文本文件必须使用 UTF-8 编码") from exc


def delete_upload(file_path: str) -> None:
    """从磁盘删除已上传文件；文件不存在时静默忽略。"""
    try:
        p = Path(file_path)
        if p.exists():
            p.unlink()
    except OSError:
        logger.warning("Failed to delete uploaded file: %s", file_path, exc_info=True)

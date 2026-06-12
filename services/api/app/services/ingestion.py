import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass
class ParsedChunk:
    text: str
    locator: str
    chunk_index: int


# ── Chunking ──────────────────────────────────────────────────────────

_CHUNK_SIZE = 1000   # characters per chunk
_CHUNK_OVERLAP = 200


def _split_text_into_chunks(text: str, chunk_size: int = _CHUNK_SIZE, overlap: int = _CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks, trying to break at sentence boundaries."""
    if not text.strip():
        return []

    sentences = re.split(r"(?<=[。！？.!?])\s*", text)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) <= chunk_size:
            current += sentence
        else:
            if current:
                chunks.append(current.strip())
            # Keep overlap: carry over the tail of the previous chunk
            if len(current) > overlap:
                current = current[-overlap:] + sentence
            else:
                current = sentence

    if current.strip():
        chunks.append(current.strip())

    return chunks


# ── Parsers ───────────────────────────────────────────────────────────

def _parse_pdf(path: str) -> list[ParsedChunk]:
    """Extract text from PDF, page by page."""
    from pypdf import PdfReader

    chunks: list[ParsedChunk] = []
    reader = PdfReader(path)
    for page_idx, page in enumerate(reader.pages, start=1):
        text = page.extract_text()
        if not text:
            continue
        page_chunks = _split_text_into_chunks(text)
        for i, chunk_text in enumerate(page_chunks):
            chunks.append(ParsedChunk(
                text=chunk_text,
                locator=f"page {page_idx}",
                chunk_index=len(chunks),
            ))
    return chunks


def _parse_docx(path: str) -> list[ParsedChunk]:
    """Extract text from DOCX, paragraph by paragraph."""
    from docx import Document

    doc = Document(path)
    full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    text_chunks = _split_text_into_chunks(full_text)
    return [
        ParsedChunk(text=t, locator="DOCX document", chunk_index=i)
        for i, t in enumerate(text_chunks)
    ]


def _parse_pptx(path: str) -> list[ParsedChunk]:
    """Extract text from PPTX, slide by slide."""
    from pptx import Presentation

    prs = Presentation(path)
    full_text_parts: list[str] = []
    for slide_idx, slide in enumerate(prs.slides, start=1):
        slide_text = " ".join(
            shape.text for shape in slide.shapes if hasattr(shape, "text") and shape.text.strip()
        )
        if slide_text:
            full_text_parts.append(f"[Slide {slide_idx}] {slide_text}")

    full_text = "\n\n".join(full_text_parts)
    text_chunks = _split_text_into_chunks(full_text)
    return [
        ParsedChunk(text=t, locator="PPTX presentation", chunk_index=i)
        for i, t in enumerate(text_chunks)
    ]


def _parse_xlsx(path: str) -> list[ParsedChunk]:
    """Extract text from XLSX, sheet by sheet."""
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    full_text_parts: list[str] = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows_text: list[str] = []
        for row in ws.iter_rows(values_only=True):
            row_str = " | ".join(str(c) for c in row if c is not None)
            if row_str.strip():
                rows_text.append(row_str)
        if rows_text:
            full_text_parts.append(f"[Sheet: {sheet_name}]\n" + "\n".join(rows_text))
    wb.close()

    full_text = "\n\n".join(full_text_parts)
    text_chunks = _split_text_into_chunks(full_text)
    return [
        ParsedChunk(text=t, locator="XLSX spreadsheet", chunk_index=i)
        for i, t in enumerate(text_chunks)
    ]


def _parse_txt(path: str) -> list[ParsedChunk]:
    """Extract text from plain text files."""
    text = Path(path).read_text(encoding="utf-8")
    text_chunks = _split_text_into_chunks(text)
    return [
        ParsedChunk(text=t, locator="text file", chunk_index=i)
        for i, t in enumerate(text_chunks)
    ]


# ── Registry ──────────────────────────────────────────────────────────

_PARSER_REGISTRY: dict[str, Callable[[str], list[ParsedChunk]]] = {
    "pdf":  _parse_pdf,
    "docx": _parse_docx,
    "doc":  _parse_docx,
    "pptx": _parse_pptx,
    "ppt":  _parse_pptx,
    "xlsx": _parse_xlsx,
    "xls":  _parse_xlsx,
    "txt":  _parse_txt,
    "md":   _parse_txt,
    "csv":  _parse_txt,
}


def parse_document(storage_path: str, file_type: str) -> list[ParsedChunk]:
    """Return parsed chunks with text and citation metadata.

    Routes to the appropriate parser based on file_type extension.
    """
    ext = file_type.lstrip(".").lower()
    parser = _PARSER_REGISTRY.get(ext)
    if parser is None:
        raise ValueError(f"Unsupported file type: {file_type}")

    return parser(storage_path)

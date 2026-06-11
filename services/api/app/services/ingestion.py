from dataclasses import dataclass


@dataclass
class ParsedChunk:
    text: str
    locator: str
    chunk_index: int


def parse_document(storage_path: str, file_type: str) -> list[ParsedChunk]:
    """Return parsed chunks with text and citation metadata.

    For the MVP with fake provider, returns a single chunk with a locator.
    """
    from app.core.config import settings

    if settings.llm_provider == "fake":
        return [
            ParsedChunk(
                text=f"Content from {storage_path} (type: {file_type})",
                locator="page 1",
                chunk_index=0,
            )
        ]

    # Real parsing would use pypdf, python-docx, etc.
    return []

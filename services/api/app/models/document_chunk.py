from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.db.base import Base


class DocumentChunk(Base):
    """Stores parsed document chunks with their vector embeddings for ANN search."""

    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("knowledge_documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    locator: Mapped[str] = mapped_column(Text, default="")
    # Embedding dimension is configured via EMBEDDING_DIMENSION env var.
    # Common values: 384 (all-MiniLM-L6-v2), 768 (all-mpnet-base-v2), 1536 (OpenAI).
    embedding: Mapped[list[float]] = mapped_column(Vector(settings.embedding_dimension), nullable=True)

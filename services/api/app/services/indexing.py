import logging

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.document import DocumentIndexStatus
from app.models.document_chunk import DocumentChunk
from app.repositories.documents import get_document_by_id, update_document
from app.repositories.llm_config import get_active_llm_config
from app.services.embedding_factory import create_embeddings
from app.services.ingestion import parse_document

logger = logging.getLogger(__name__)


def _get_embedding_model():
    """Resolve an embedding model.

    For remote providers (openai, zhipu, etc.): reuses the active LLM config's
    API key / base URL, but uses the embedding_model_name from settings.

    For local providers (huggingface): no LLM config needed – runs entirely
    offline with models auto-downloaded from HuggingFace Hub.
    """
    provider = settings.embedding_provider

    if provider == "huggingface":
        return create_embeddings(
            provider="huggingface",
            model_name=settings.embedding_model_name,
        )

    # Remote providers need an active LLM config for the API key
    active_cfg = get_active_llm_config()
    if active_cfg is None:
        raise RuntimeError("No active LLM config found – cannot generate embeddings")

    return create_embeddings(
        provider=active_cfg.provider,
        model_name=settings.embedding_model_name,
        api_key=active_cfg.api_key,
        base_url=active_cfg.base_url,
    )


def index_document(document_id: int) -> None:
    """Parse an approved document, generate embeddings, store chunks in pgvector.

    Steps:
    1. Mark document as INDEXING
    2. Parse the file into text chunks
    3. Generate vector embeddings for each chunk
    4. Store chunks + embeddings in document_chunks table
    5. Mark document as INDEXED (or FAILED on error)
    """
    document = get_document_by_id(document_id)
    if document is None:
        return

    db = SessionLocal()
    try:
        # 1. Mark as indexing
        update_document(document_id, index_status=DocumentIndexStatus.INDEXING.value)

        # 2. Parse the document into text chunks
        chunks = parse_document(document.storage_path, document.file_type)
        if not chunks:
            update_document(
                document_id,
                index_status=DocumentIndexStatus.FAILED.value,
                failure_reason="No parseable content found",
            )
            return

        # 3. Generate embeddings
        embed_model = _get_embedding_model()
        texts = [chunk.text for chunk in chunks]
        embeddings = embed_model.embed_documents(texts)

        # 4. Delete old chunks for this document (re-index scenario)
        db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document_id
        ).delete()

        # 5. Store chunks with embeddings
        for chunk, embedding in zip(chunks, embeddings):
            db.add(DocumentChunk(
                document_id=document_id,
                chunk_index=chunk.chunk_index,
                text=chunk.text,
                locator=chunk.locator,
                embedding=embedding,
            ))

        db.commit()

        # 6. Mark as indexed
        update_document(document_id, index_status=DocumentIndexStatus.INDEXED.value)

    except Exception as e:
        db.rollback()
        logger.exception("Indexing failed for document %s", document_id)
        update_document(
            document_id,
            index_status=DocumentIndexStatus.FAILED.value,
            failure_reason=str(e),
        )
    finally:
        db.close()

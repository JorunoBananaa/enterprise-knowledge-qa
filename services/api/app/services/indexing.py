from app.models.document import DocumentIndexStatus
from app.repositories.documents import get_document_by_id, update_document
from app.services.ingestion import parse_document


def index_document(document_id: int) -> None:
    """Parse an approved document, store chunks, and update index status.

    For the MVP with fake embeddings, simply marks the document as indexed.
    """
    document = get_document_by_id(document_id)
    if document is None:
        return

    try:
        # Mark as indexing
        update_document(document_id, index_status=DocumentIndexStatus.INDEXING.value)

        # Parse the document
        chunks = parse_document(document.storage_path, document.file_type)

        # In a real implementation, generate embeddings and store chunks in pgvector.
        # For MVP with fake provider, we just mark success.
        if chunks:
            update_document(document_id, index_status=DocumentIndexStatus.INDEXED.value)
        else:
            update_document(
                document_id,
                index_status=DocumentIndexStatus.FAILED.value,
                failure_reason="No parseable content found",
            )
    except Exception as e:
        update_document(
            document_id,
            index_status=DocumentIndexStatus.FAILED.value,
            failure_reason=str(e),
        )

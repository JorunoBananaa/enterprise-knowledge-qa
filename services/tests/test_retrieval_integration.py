from __future__ import annotations

from uuid import uuid4
import unittest

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import engine
from app.models.category import KnowledgeCategory
from app.models.document import (
    DocumentIndexStatus,
    DocumentReviewStatus,
    KnowledgeDocument,
)
from app.models.document_chunk import DocumentChunk
from app.models.user import User, UserRole, UserStatus
from app.services.retrieval import (
    EvidenceDecision,
    EvidencePolicy,
    KnowledgeRetriever,
    Principal,
    RetrievalScope,
)


def _vector(first: float) -> list[float]:
    return [first, *([0.0] * (settings.embedding_dimension - 1))]


class KnowledgeRetrieverIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        self.db = Session(bind=self.connection, expire_on_commit=False)

        unique = uuid4().hex
        self.user = User(
            username=f"retrieval-{unique}",
            display_name="Retrieval Test User",
            password_hash="not-used",
            role=UserRole.STANDARD,
            status=UserStatus.ACTIVE,
            token_version=0,
        )
        self.category = KnowledgeCategory(name=f"retrieval-{unique}")
        self.db.add_all([self.user, self.category])
        self.db.flush()

    def tearDown(self) -> None:
        self.db.close()
        self.transaction.rollback()
        self.connection.close()

    def _document(
        self,
        *,
        review_status: DocumentReviewStatus,
        index_status: DocumentIndexStatus,
        embedding: list[float] | None = None,
    ) -> KnowledgeDocument:
        document = KnowledgeDocument(
            title=f"Document {uuid4().hex}",
            file_type="txt",
            storage_path="test-only.txt",
            uploader_id=self.user.id,
            category_id=self.category.id,
            review_status=review_status,
            index_status=index_status.value,
        )
        self.db.add(document)
        self.db.flush()
        self.db.add(
            DocumentChunk(
                document_id=document.id,
                chunk_index=0,
                text=f"Evidence for document {document.id}",
                locator="test",
                embedding=_vector(1.0) if embedding is None else embedding,
            )
        )
        self.db.flush()
        return document

    async def test_only_approved_and_indexed_documents_are_retrievable(self) -> None:
        approved = self._document(
            review_status=DocumentReviewStatus.APPROVED,
            index_status=DocumentIndexStatus.INDEXED,
        )
        pending = self._document(
            review_status=DocumentReviewStatus.PENDING_REVIEW,
            index_status=DocumentIndexStatus.INDEXED,
        )
        rejected = self._document(
            review_status=DocumentReviewStatus.REJECTED,
            index_status=DocumentIndexStatus.INDEXED,
        )
        not_indexed = self._document(
            review_status=DocumentReviewStatus.APPROVED,
            index_status=DocumentIndexStatus.NOT_INDEXED,
        )
        null_embedding = self._document(
            review_status=DocumentReviewStatus.APPROVED,
            index_status=DocumentIndexStatus.INDEXED,
            embedding=None,
        )
        approved_outside_scope = self._document(
            review_status=DocumentReviewStatus.APPROVED,
            index_status=DocumentIndexStatus.INDEXED,
        )
        self.db.query(DocumentChunk).filter(
            DocumentChunk.document_id == null_embedding.id
        ).update({DocumentChunk.embedding: None})
        self.db.flush()

        async def embed_query(_query: str) -> list[float]:
            return _vector(1.0)

        retriever = KnowledgeRetriever(self.db, embed_query=embed_query)
        result = await retriever.search(
            query="approved evidence",
            principal=Principal(user_id=self.user.id, role="standard"),
            scope=RetrievalScope(
                document_ids=(
                    approved.id,
                    pending.id,
                    rejected.id,
                    not_indexed.id,
                    null_embedding.id,
                )
            ),
            policy=EvidencePolicy(min_similarity=-1.0, max_evidence=10),
        )

        self.assertEqual(result.decision, EvidenceDecision.SUFFICIENT)
        self.assertEqual(
            [candidate.document_id for candidate in result.evidence],
            [approved.id],
        )
        self.assertNotIn(
            approved_outside_scope.id,
            [candidate.document_id for candidate in result.candidates],
        )
        self.assertEqual(
            result.to_context_chunks()[0]["document_path"],
            self.category.name,
        )

    async def test_empty_scope_returns_no_evidence_without_embedding(self) -> None:
        embedding_called = False

        async def embed_query(_query: str) -> list[float]:
            nonlocal embedding_called
            embedding_called = True
            return _vector(1.0)

        result = await KnowledgeRetriever(
            self.db,
            embed_query=embed_query,
        ).search(
            query="nothing selected",
            principal=Principal(user_id=self.user.id, role="standard"),
            scope=RetrievalScope(document_ids=()),
            policy=EvidencePolicy(min_similarity=0.50),
        )

        self.assertFalse(embedding_called)
        self.assertEqual(result.decision, EvidenceDecision.INSUFFICIENT)
        self.assertEqual(result.reason, "no_candidates")


if __name__ == "__main__":
    unittest.main()

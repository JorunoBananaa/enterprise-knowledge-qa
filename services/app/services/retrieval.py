from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.models.category import KnowledgeCategory
from app.models.document import (
    DocumentIndexStatus,
    DocumentReviewStatus,
    KnowledgeDocument,
)
from app.models.document_chunk import DocumentChunk


EmbedQuery = Callable[[str], Awaitable[list[float]]]


class EvidenceDecision(str, Enum):
    SUFFICIENT = "sufficient"
    INSUFFICIENT = "insufficient_evidence"


@dataclass(frozen=True)
class Principal:
    user_id: int
    role: str


@dataclass(frozen=True)
class RetrievalScope:
    document_ids: tuple[int, ...] | None = None


@dataclass(frozen=True)
class RetrievalCandidate:
    chunk_id: int
    document_id: int
    document_title: str
    document_file_type: str
    document_category_id: int
    locator: str
    text: str
    distance: float
    similarity: float
    document_path: str | None = None

    def to_context_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "document_title": self.document_title,
            "document_name": self.document_title,
            "document_file_type": self.document_file_type,
            "document_category_id": self.document_category_id,
            "document_path": self.document_path,
            "locator": self.locator,
            "text": self.text,
            "distance": self.distance,
            "similarity": self.similarity,
        }


@dataclass(frozen=True)
class RetrievalResult:
    candidates: tuple[RetrievalCandidate, ...]
    evidence: tuple[RetrievalCandidate, ...]
    decision: EvidenceDecision
    reason: str | None
    policy_id: str

    def to_context_chunks(self) -> list[dict[str, Any]]:
        """只把 EvidencePolicy 接受的证据交给生成与引用链路。"""
        return [candidate.to_context_dict() for candidate in self.evidence]


@dataclass(frozen=True)
class EvidencePolicy:
    min_similarity: float
    max_evidence: int = 5
    policy_id: str = "unversioned"

    def __post_init__(self) -> None:
        if not -1.0 <= self.min_similarity <= 1.0:
            raise ValueError("min_similarity must be between -1.0 and 1.0")
        if self.max_evidence <= 0:
            raise ValueError("max_evidence must be greater than 0")
        if not self.policy_id.strip():
            raise ValueError("policy_id must not be blank")

    def evaluate(
        self,
        candidates: tuple[RetrievalCandidate, ...],
    ) -> RetrievalResult:
        if not candidates:
            return RetrievalResult(
                candidates=(),
                evidence=(),
                decision=EvidenceDecision.INSUFFICIENT,
                reason="no_candidates",
                policy_id=self.policy_id,
            )

        evidence = tuple(
            candidate
            for candidate in candidates
            if candidate.similarity >= self.min_similarity
        )[: self.max_evidence]
        if not evidence:
            return RetrievalResult(
                candidates=candidates,
                evidence=(),
                decision=EvidenceDecision.INSUFFICIENT,
                reason="below_similarity_threshold",
                policy_id=self.policy_id,
            )
        return RetrievalResult(
            candidates=candidates,
            evidence=evidence,
            decision=EvidenceDecision.SUFFICIENT,
            reason=None,
            policy_id=self.policy_id,
        )


class KnowledgeRetriever:
    """统一执行状态/范围过滤、向量召回和证据决策。"""

    def __init__(
        self,
        db: Session,
        *,
        embed_query: EmbedQuery,
        candidate_k: int = 20,
    ) -> None:
        self._db = db
        self._embed_query = embed_query
        self._candidate_k = candidate_k

    async def search(
        self,
        *,
        query: str,
        principal: Principal,
        scope: RetrievalScope,
        policy: EvidencePolicy,
    ) -> RetrievalResult:
        if principal.user_id <= 0:
            raise ValueError("principal.user_id 必须是有效用户 ID")
        if scope.document_ids == ():
            return policy.evaluate(())

        query_embedding = await self._embed_query(query)
        distance_expression = DocumentChunk.embedding.cosine_distance(
            query_embedding
        )
        statement = (
            self._db.query(
                DocumentChunk,
                KnowledgeDocument,
                distance_expression.label("distance"),
            )
            .join(
                KnowledgeDocument,
                KnowledgeDocument.id == DocumentChunk.document_id,
            )
            .filter(
                KnowledgeDocument.review_status == DocumentReviewStatus.APPROVED,
                KnowledgeDocument.index_status == DocumentIndexStatus.INDEXED.value,
                DocumentChunk.embedding.isnot(None),
            )
        )
        if scope.document_ids is not None:
            statement = statement.filter(
                DocumentChunk.document_id.in_(scope.document_ids)
            )

        rows = (
            statement.order_by(distance_expression.asc())
            .limit(self._candidate_k)
            .all()
        )
        category_paths = self._build_category_path_map() if rows else {}
        candidates = tuple(
            RetrievalCandidate(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_title=document.title,
                document_file_type=document.file_type,
                document_category_id=document.category_id,
                document_path=category_paths.get(document.category_id),
                locator=chunk.locator,
                text=chunk.text,
                distance=float(distance),
                similarity=1.0 - float(distance),
            )
            for chunk, document, distance in rows
        )
        return policy.evaluate(candidates)

    def _build_category_path_map(self) -> dict[int, str]:
        categories = self._db.query(KnowledgeCategory).all()
        category_by_id = {category.id: category for category in categories}
        paths: dict[int, str] = {}

        for category in categories:
            names: list[str] = []
            visited: set[int] = set()
            current: KnowledgeCategory | None = category
            while current is not None and current.id not in visited:
                visited.add(current.id)
                names.append(current.name)
                current = category_by_id.get(current.parent_id)
            paths[category.id] = " / ".join(reversed(names))

        return paths

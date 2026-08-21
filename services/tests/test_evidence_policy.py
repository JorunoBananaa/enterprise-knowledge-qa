from __future__ import annotations

import unittest

from app.services.retrieval import (
    EvidenceDecision,
    EvidencePolicy,
    RetrievalCandidate,
)


def _candidate(*, chunk_id: int, similarity: float) -> RetrievalCandidate:
    return RetrievalCandidate(
        chunk_id=chunk_id,
        document_id=chunk_id,
        document_title=f"Document {chunk_id}",
        document_file_type="txt",
        document_category_id=1,
        locator="test",
        text="evidence",
        distance=1.0 - similarity,
        similarity=similarity,
    )


class EvidencePolicyTests(unittest.TestCase):
    def test_invalid_threshold_configuration_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            EvidencePolicy(min_similarity=1.01)

        with self.assertRaises(ValueError):
            EvidencePolicy(min_similarity=0.50, max_evidence=0)

        with self.assertRaises(ValueError):
            EvidencePolicy(
                min_similarity=0.50,
                policy_id=" ",
            )

    def test_low_similarity_candidates_produce_versioned_rejection(self) -> None:
        policy = EvidencePolicy(
            policy_id="cosine-initial-v1",
            min_similarity=0.50,
            max_evidence=5,
        )

        result = policy.evaluate((_candidate(chunk_id=1, similarity=0.49),))

        self.assertEqual(result.decision, EvidenceDecision.INSUFFICIENT)
        self.assertEqual(result.evidence, ())
        self.assertEqual(result.reason, "below_similarity_threshold")
        self.assertEqual(result.policy_id, "cosine-initial-v1")

    def test_generation_context_contains_only_accepted_evidence(self) -> None:
        policy = EvidencePolicy(
            policy_id="cosine-initial-v1",
            min_similarity=0.50,
            max_evidence=5,
        )
        accepted = _candidate(chunk_id=1, similarity=0.90)
        rejected = _candidate(chunk_id=2, similarity=0.20)

        result = policy.evaluate((accepted, rejected))

        self.assertEqual(
            [chunk["chunk_id"] for chunk in result.to_context_chunks()],
            [accepted.chunk_id],
        )


if __name__ == "__main__":
    unittest.main()

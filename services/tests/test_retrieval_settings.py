from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.core.config import Settings


class RetrievalSettingsTests(unittest.TestCase):
    def test_local_ollama_defaults_match_project_runtime(self) -> None:
        configured = Settings()

        self.assertEqual(configured.embedding_model_name, "qwen3-embedding:latest")
        self.assertEqual(configured.ollama_base_url, "http://127.0.0.1:12434/v1")

    def test_retrieval_policy_settings_are_explicit(self) -> None:
        configured = Settings(
            retrieval_candidate_k=12,
            retrieval_max_evidence=4,
            retrieval_min_similarity=0.55,
            retrieval_policy_id="cosine-calibrated-v2",
        )

        self.assertEqual(configured.retrieval_candidate_k, 12)
        self.assertEqual(configured.retrieval_max_evidence, 4)
        self.assertEqual(configured.retrieval_min_similarity, 0.55)
        self.assertEqual(configured.retrieval_policy_id, "cosine-calibrated-v2")

    def test_max_evidence_cannot_exceed_candidate_count(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                retrieval_candidate_k=3,
                retrieval_max_evidence=4,
            )


if __name__ == "__main__":
    unittest.main()

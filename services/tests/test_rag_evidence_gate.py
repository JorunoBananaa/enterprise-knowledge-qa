from __future__ import annotations

import unittest

from app.services.rag import INSUFFICIENT_EVIDENCE_ANSWER, answer_question_stream


class RagEvidenceGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_final_evidence_refuses_without_calling_llm(self) -> None:
        events = [
            event
            async for event in answer_question_stream(
                question="unsupported question",
                retrieved_chunks=[],
                system_prompt=None,
                user_prompt=None,
                llm=None,  # type: ignore[arg-type]
            )
        ]

        self.assertEqual(
            events,
            [
                {"type": "chunk", "text": INSUFFICIENT_EVIDENCE_ANSWER},
                {"type": "done", "status": "insufficient_evidence"},
            ],
        )
        self.assertFalse(any(event["type"] == "citation" for event in events))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest

from app.models.chat import ChatMessage, ChatSession, Citation
from app.services.chat_persistence import (
    persist_new_chat_session,
    persist_streamed_chat_message,
)


class FakeDbSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flush_count = 0
        self.commit_count = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flush_count += 1
        for obj in self.added:
            if isinstance(obj, ChatMessage) and obj.id is None:
                obj.id = 42

    def commit(self) -> None:
        self.commit_count += 1


class PersistStreamedChatMessageTest(unittest.TestCase):
    def test_commits_new_session_before_answer_stream_finishes(self) -> None:
        db = FakeDbSession()

        session = persist_new_chat_session(
            db,
            user_id="user-1",
            title="第一问",
        )

        self.assertIsInstance(session, ChatSession)
        self.assertEqual(session.user_id, "user-1")
        self.assertEqual(session.title, "第一问")
        self.assertEqual(db.flush_count, 1)
        self.assertEqual(db.commit_count, 1)

    def test_preserves_partial_answer_when_aborted(self) -> None:
        db = FakeDbSession()

        msg = persist_streamed_chat_message(
            db,
            session_id=7,
            question="请总结制度",
            answer_parts=["先输出", "一半"],
            result_status="aborted",
            citations=[],
        )

        self.assertEqual(msg.session_id, 7)
        self.assertEqual(msg.question, "请总结制度")
        self.assertEqual(msg.answer, "先输出一半")
        self.assertEqual(msg.result_status, "aborted")
        self.assertNotIn("已停止生成", msg.answer)
        self.assertEqual(db.flush_count, 1)
        self.assertEqual(db.commit_count, 1)
        self.assertEqual(len(db.added), 1)

    def test_saves_citations_against_flushed_message_id(self) -> None:
        db = FakeDbSession()

        msg = persist_streamed_chat_message(
            db,
            session_id=8,
            question="引用来源是什么",
            answer_parts=["答案"],
            result_status="answered",
            citations=[
                {
                    "document_id": 11,
                    "chunk_id": 12,
                    "locator": "p.3",
                    "quoted_text_preview": "引用片段",
                    "rank": 2,
                }
            ],
        )

        self.assertEqual(msg.id, 42)
        self.assertEqual(len(db.added), 2)
        citation = db.added[1]
        self.assertIsInstance(citation, Citation)
        self.assertEqual(citation.chat_message_id, 42)
        self.assertEqual(citation.document_id, 11)
        self.assertEqual(citation.chunk_id, 12)
        self.assertEqual(citation.locator, "p.3")
        self.assertEqual(citation.quoted_text_preview, "引用片段")
        self.assertEqual(citation.rank, 2)


if __name__ == "__main__":
    unittest.main()

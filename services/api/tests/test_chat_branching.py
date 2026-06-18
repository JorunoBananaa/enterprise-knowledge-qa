from __future__ import annotations

from datetime import datetime, timedelta
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.models.category import KnowledgeCategory
from app.models.chat import ChatMessage, ChatSession, Citation
from app.models.document import KnowledgeDocument
from app.models.user import User, UserRole, UserStatus
from app.services.chat_branching import (
    ChatBranchTargetNotFound,
    fork_chat_session_at_message,
)


class ForkChatSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.db: Session = self.SessionLocal()

        self.user = User(
            username="owner",
            display_name="Owner",
            password_hash="x",
            role=UserRole.STANDARD,
            status=UserStatus.ACTIVE,
            token_version=0,
        )
        self.other_user = User(
            username="other",
            display_name="Other",
            password_hash="x",
            role=UserRole.STANDARD,
            status=UserStatus.ACTIVE,
            token_version=0,
        )
        self.category = KnowledgeCategory(name="制度")
        self.db.add_all([self.user, self.other_user, self.category])
        self.db.flush()

        self.document = KnowledgeDocument(
            title="报销制度",
            file_type="pdf",
            storage_path="/tmp/a.pdf",
            uploader_id=self.user.id,
            category_id=self.category.id,
        )
        self.db.add(self.document)
        self.db.flush()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _create_session_with_messages(self) -> tuple[ChatSession, list[ChatMessage]]:
        session = ChatSession(user_id=str(self.user.id), title="报销问题")
        self.db.add(session)
        self.db.flush()

        base_time = datetime(2026, 6, 18, 10, 0, 0)
        messages = [
            ChatMessage(
                session_id=session.id,
                question="第一问",
                answer="第一答",
                result_status="answered",
                created_at=base_time,
            ),
            ChatMessage(
                session_id=session.id,
                question="第二问",
                answer="第二答",
                result_status="insufficient_evidence",
                created_at=base_time + timedelta(minutes=1),
            ),
            ChatMessage(
                session_id=session.id,
                question="第三问",
                answer="第三答",
                result_status="answered",
                created_at=base_time + timedelta(minutes=2),
            ),
        ]
        self.db.add_all(messages)
        self.db.flush()
        self.db.add(
            Citation(
                chat_message_id=messages[1].id,
                document_id=self.document.id,
                chunk_id=88,
                locator="p.2",
                quoted_text_preview="引用内容",
                rank=3,
            )
        )
        self.db.commit()
        return session, messages

    def test_forks_messages_through_target_only(self) -> None:
        source_session, messages = self._create_session_with_messages()

        new_session = fork_chat_session_at_message(
            self.db,
            user_id=str(self.user.id),
            message_id=messages[1].id,
        )

        self.assertNotEqual(new_session.id, source_session.id)
        self.assertEqual(new_session.user_id, str(self.user.id))
        self.assertEqual(new_session.title, source_session.title)

        copied = (
            self.db.query(ChatMessage)
            .filter(ChatMessage.session_id == new_session.id)
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .all()
        )
        self.assertEqual([m.question for m in copied], ["第一问", "第二问"])
        self.assertEqual([m.answer for m in copied], ["第一答", "第二答"])
        self.assertEqual(
            [m.result_status for m in copied],
            ["answered", "insufficient_evidence"],
        )

    def test_copies_citations_to_new_message_ids(self) -> None:
        _source_session, messages = self._create_session_with_messages()

        new_session = fork_chat_session_at_message(
            self.db,
            user_id=str(self.user.id),
            message_id=messages[1].id,
        )

        copied_messages = (
            self.db.query(ChatMessage)
            .filter(ChatMessage.session_id == new_session.id)
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .all()
        )
        copied_second_message = copied_messages[1]
        copied_citations = (
            self.db.query(Citation)
            .filter(Citation.chat_message_id == copied_second_message.id)
            .all()
        )

        self.assertEqual(len(copied_citations), 1)
        citation = copied_citations[0]
        self.assertNotEqual(citation.chat_message_id, messages[1].id)
        self.assertEqual(citation.document_id, self.document.id)
        self.assertEqual(citation.chunk_id, 88)
        self.assertEqual(citation.locator, "p.2")
        self.assertEqual(citation.quoted_text_preview, "引用内容")
        self.assertEqual(citation.rank, 3)

    def test_rejects_other_users_message(self) -> None:
        _source_session, messages = self._create_session_with_messages()

        with self.assertRaises(ChatBranchTargetNotFound):
            fork_chat_session_at_message(
                self.db,
                user_id=str(self.other_user.id),
                message_id=messages[0].id,
            )


if __name__ == "__main__":
    unittest.main()

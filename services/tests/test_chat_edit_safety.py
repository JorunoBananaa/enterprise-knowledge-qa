from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api.routes.qa import router as qa_router
from app.db.session import engine
from app.models.chat import ChatMessage, ChatSession
from app.schemas.auth import CurrentUser


class ChatEditSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = engine.connect()
        self.transaction = self.connection.begin()
        self.db = Session(bind=self.connection, expire_on_commit=False)
        self.user = CurrentUser(
            id=9_000_001,
            username="chat-edit-test",
            display_name="Chat Edit Test",
            role="standard",
            status="active",
        )
        source = ChatSession(user_id=str(self.user.id), title="Original chat")
        self.db.add(source)
        self.db.flush()
        first = ChatMessage(
            session_id=source.id,
            question="original question",
            answer="original answer",
            result_status="answered",
        )
        second = ChatMessage(
            session_id=source.id,
            question="follow-up question",
            answer="follow-up answer",
            result_status="answered",
        )
        self.db.add_all([first, second])
        self.db.flush()
        self.source_session_id = source.id
        self.edit_message_id = first.id

        app = FastAPI()
        app.include_router(qa_router, prefix="/qa")

        def override_db():
            yield self.db

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        self.db.close()
        self.transaction.rollback()
        self.connection.close()

    def test_failed_edit_keeps_original_conversation_unchanged(self) -> None:
        response = self.client.post(
            "/qa/ask/stream",
            json={
                "question": "edited question",
                "session_id": self.source_session_id,
                "llm_config_id": 2_147_483_647,
                "request_id": str(uuid4()),
                "edit_message_id": self.edit_message_id,
                "session_version": 1,
            },
        )

        self.assertEqual(response.status_code, 404)
        source = self.client.get(f"/qa/sessions/{self.source_session_id}")
        self.assertEqual(source.status_code, 200)
        self.assertEqual(
            [message["question"] for message in source.json()["messages"]],
            ["original question", "follow-up question"],
        )

    def test_successful_edit_creates_traceable_branch(self) -> None:
        class NoToolLlm:
            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                return SimpleNamespace(tool_calls=[])

        with patch("app.api.routes.qa._resolve_llm", return_value=NoToolLlm()):
            response = self.client.post(
                "/qa/ask/stream",
                json={
                    "question": "edited question",
                    "session_id": self.source_session_id,
                    "llm_config_id": 1,
                    "category_ids": [2_147_483_647],
                    "request_id": str(uuid4()),
                    "edit_message_id": self.edit_message_id,
                    "session_version": 1,
                },
            )

        self.assertEqual(response.status_code, 200)
        session_event = next(
            block
            for block in response.text.split("\n\n")
            if block.startswith("event: session")
        )
        branch_session_id = int(
            session_event.split("data: ", 1)[1].split('"session_id": ', 1)[1].split("}", 1)[0]
        )
        self.assertNotEqual(branch_session_id, self.source_session_id)

        source = self.client.get(f"/qa/sessions/{self.source_session_id}").json()
        branch = self.client.get(f"/qa/sessions/{branch_session_id}").json()
        self.assertEqual(
            [message["question"] for message in source["messages"]],
            ["original question", "follow-up question"],
        )
        self.assertEqual(
            [message["question"] for message in branch["messages"]],
            ["edited question"],
        )
        self.assertEqual(branch["parent_session_id"], self.source_session_id)
        self.assertEqual(branch["branch_from_message_id"], self.edit_message_id)
        self.assertEqual(branch["visibility"], "active")
        self.assertEqual(branch["version"], 1)

    def test_stale_session_version_cannot_create_a_second_edit_branch(self) -> None:
        class NoToolLlm:
            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                return SimpleNamespace(tool_calls=[])

        def edit() -> object:
            return self.client.post(
                "/qa/ask/stream",
                json={
                    "question": "edited question",
                    "session_id": self.source_session_id,
                    "session_version": 1,
                    "llm_config_id": 1,
                    "category_ids": [2_147_483_647],
                    "request_id": str(uuid4()),
                    "edit_message_id": self.edit_message_id,
                },
            )

        with patch("app.api.routes.qa._resolve_llm", return_value=NoToolLlm()):
            first = edit()
            stale = edit()

        self.assertEqual(first.status_code, 200)  # type: ignore[attr-defined]
        self.assertEqual(stale.status_code, 409)  # type: ignore[attr-defined]
        sessions = self.client.get("/qa/sessions").json()
        self.assertEqual(len(sessions), 2)
        source = next(
            session for session in sessions if session["id"] == self.source_session_id
        )
        self.assertEqual(source["version"], 2)

    def test_completed_request_id_replays_without_duplicate_message(self) -> None:
        class NoToolLlm:
            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                return SimpleNamespace(tool_calls=[])

        request_id = str(uuid4())
        empty_session = ChatSession(user_id=str(self.user.id), title="Idempotency")
        self.db.add(empty_session)
        self.db.flush()

        def ask():
            return self.client.post(
                "/qa/ask/stream",
                json={
                    "question": "idempotent question",
                    "session_id": empty_session.id,
                    "llm_config_id": 1,
                    "category_ids": [2_147_483_647],
                    "request_id": request_id,
                },
            )

        with patch("app.api.routes.qa._resolve_llm", return_value=NoToolLlm()):
            first = ask()
            replay = ask()

        def message_id(response) -> int:
            done = next(
                block
                for block in response.text.split("\n\n")
                if block.startswith("event: done")
            )
            return int(
                done.split('"message_id": ', 1)[1].split(",", 1)[0].split("}", 1)[0]
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(message_id(first), message_id(replay))
        request_status = self.client.get(f"/qa/requests/{request_id}")
        self.assertEqual(request_status.status_code, 200)
        self.assertEqual(
            request_status.json(),
            {
                "request_id": request_id,
                "status": "insufficient_evidence",
                "session_id": empty_session.id,
                "message_id": message_id(first),
            },
        )
        session = self.client.get(f"/qa/sessions/{empty_session.id}").json()
        self.assertEqual(len(session["messages"]), 1)


if __name__ == "__main__":
    unittest.main()

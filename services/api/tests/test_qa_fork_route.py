from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.api.routes.qa import fork_message
from app.schemas.auth import CurrentUser
from app.services.chat_branching import ChatBranchTargetNotFound


def current_user() -> CurrentUser:
    return CurrentUser(
        id=7,
        username="owner",
        display_name="Owner",
        role="standard",
        status="active",
    )


class ForkMessageRouteTest(unittest.TestCase):
    @patch("app.api.routes.qa.fork_chat_session_at_message")
    def test_returns_new_session_id(self, fork_service: Mock) -> None:
        fork_service.return_value = SimpleNamespace(id=123)
        db = object()

        response = fork_message(
            message_id=45,
            current_user=current_user(),
            db=db,
        )

        self.assertEqual(response.session_id, 123)
        fork_service.assert_called_once_with(db, user_id="7", message_id=45)

    @patch("app.api.routes.qa.fork_chat_session_at_message")
    def test_maps_missing_target_to_404(self, fork_service: Mock) -> None:
        fork_service.side_effect = ChatBranchTargetNotFound()

        with self.assertRaises(HTTPException) as raised:
            fork_message(
                message_id=99,
                current_user=current_user(),
                db=object(),
            )

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(raised.exception.detail, "消息不存在")


if __name__ == "__main__":
    unittest.main()

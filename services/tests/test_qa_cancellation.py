from __future__ import annotations

import asyncio
import unittest
from uuid import uuid4

from app.api.routes import qa
from app.schemas.auth import CurrentUser
from app.schemas.chat import AskCancelRequest


class QaCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_user_cannot_cancel_another_users_request(self) -> None:
        request_id = str(uuid4())
        owner = CurrentUser(
            id=101,
            username="owner",
            display_name="Owner",
            role="standard",
            status="active",
        )
        other = CurrentUser(
            id=202,
            username="other",
            display_name="Other",
            role="standard",
            status="active",
        )
        state = qa.AskCancelState(event=asyncio.Event())
        owner_key = (owner.id, request_id)
        qa._ASK_CANCEL_STATES[request_id] = state  # type: ignore[index]
        qa._ASK_CANCEL_STATES[owner_key] = state  # type: ignore[index]
        try:
            denied = await qa.cancel_question_stream(
                AskCancelRequest(request_id=request_id),
                other,
            )
            self.assertEqual(denied, {"cancelled": False})
            self.assertFalse(state.event.is_set())

            allowed = await qa.cancel_question_stream(
                AskCancelRequest(request_id=request_id),
                owner,
            )
            self.assertEqual(allowed, {"cancelled": True})
            self.assertTrue(state.event.is_set())
        finally:
            qa._ASK_CANCEL_STATES.pop(request_id, None)  # type: ignore[arg-type]
            qa._ASK_CANCEL_STATES.pop(owner_key, None)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()

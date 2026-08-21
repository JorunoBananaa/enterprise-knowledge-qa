from __future__ import annotations

import unittest

from app.services.qa_tools.registry import execute_qa_tool_plans
from app.services.qa_tools.review_approval import REVIEW_APPROVAL_TOOL_NAME
from app.services.qa_tools.review_rejection import REVIEW_REJECTION_TOOL_NAME
from app.services.qa_tools.types import QaToolContext, QaToolPlan


class QaToolSafetyTests(unittest.TestCase):
    def test_chat_cannot_execute_write_tools_without_confirmation(self) -> None:
        results = execute_qa_tool_plans(
            QaToolContext(user_id=1, role="admin"),
            [
                QaToolPlan(
                    name=REVIEW_APPROVAL_TOOL_NAME,
                    args={"document_id": 2_147_483_647},
                ),
                QaToolPlan(
                    name=REVIEW_REJECTION_TOOL_NAME,
                    args={"document_id": 2_147_483_647, "reason": "unsafe"},
                ),
            ],
        )

        self.assertEqual(len(results), 2)
        self.assertEqual(
            [result.metadata.get("error") for result in results],
            ["confirmation_required", "confirmation_required"],
        )


if __name__ == "__main__":
    unittest.main()

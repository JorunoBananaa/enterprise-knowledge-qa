from __future__ import annotations

from types import SimpleNamespace

from app.models.document import DocumentReviewStatus
from app.services.qa_tools.review_list import get_review_list
from app.services.qa_tools.types import QaToolContext


class _FakeQuery:
    def __init__(self, documents: list[SimpleNamespace]) -> None:
        self._documents = documents

    def filter(self, *_args: object) -> "_FakeQuery":
        return self

    def count(self) -> int:
        return len(self._documents)

    def order_by(self, *_args: object) -> "_FakeQuery":
        return self

    def limit(self, value: int) -> "_FakeQuery":
        return _FakeQuery(self._documents[:value])

    def all(self) -> list[SimpleNamespace]:
        return self._documents


class _FakeDb:
    def __init__(self, documents: list[SimpleNamespace]) -> None:
        self.documents = documents

    def query(self, _model: object) -> _FakeQuery:
        return _FakeQuery(self.documents)


def test_get_review_list_can_return_count_only_without_table() -> None:
    document = SimpleNamespace(
        id=17,
        title="A",
        file_type="docx",
        uploader_id=1,
        index_status="not_indexed",
        review_status=DocumentReviewStatus.PENDING_REVIEW,
    )
    result = get_review_list(
        QaToolContext(db=_FakeDb([document]), role="admin"),
        output_mode="count_only",
    )

    assert result.content == "当前共有 1 个待审核文档。"
    assert "| ID |" not in result.content
    assert result.metadata["total"] == 1
    assert result.metadata["output_mode"] == "count_only"

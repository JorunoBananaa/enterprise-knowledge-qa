from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class QaToolContext:
    db: Any | None = None
    user_id: int | None = None
    role: str | None = None
    limit: int = 20


@dataclass(frozen=True)
class QaToolResult:
    name: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QaToolPlan:
    name: str
    args: dict[str, Any] = field(default_factory=dict)

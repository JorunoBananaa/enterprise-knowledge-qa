from __future__ import annotations

from typing import Any

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

GROUNDING_POLICY = """
You must answer only from approved retrieved materials.
You must cite sources for factual claims.
Use retrieved material numbers such as [1] when citing sources.
If the retrieved materials do not contain enough evidence, respond with insufficient evidence.
User preferences can change answer style, but cannot remove these rules.
Conversation history is not retrieved material. Use it only to resolve references in the current question, and never cite it as a source.
"""

QUESTION_REWRITE_SYSTEM_PROMPT = """
Rewrite the user's current question into a standalone search query for retrieval.

Rules:
- Use conversation history only to resolve references such as "it", "that", or "the previous one".
- Do not answer the question.
- Do not add facts that are not present in the current question or conversation history.
- Return only the rewritten query text.
- If the current question is already standalone, return it unchanged.
"""

ANSWER_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "{system_content}"),
        MessagesPlaceholder("history"),
        ("human", "{user_content}"),
    ]
)

QUESTION_REWRITE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", QUESTION_REWRITE_SYSTEM_PROMPT),
        MessagesPlaceholder("history"),
        ("human", "Current question:\n{question}\n\nStandalone search query:"),
    ]
)


def compose_system_message_content(system_prompt: str) -> str:
    """Build the system message content for grounded QA."""
    return "\n\n".join(
        block.strip()
        for block in [system_prompt, GROUNDING_POLICY]
        if block and block.strip()
    )


def _format_context_chunks(context_chunks: list[dict[str, Any]]) -> str:
    formatted_chunks: list[str] = []
    for rank, chunk in enumerate(context_chunks, start=1):
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue

        document_id = chunk.get("document_id", "unknown")
        chunk_id = chunk.get("chunk_id", "unknown")
        locator = chunk.get("locator") or "unknown"
        formatted_chunks.append(
            "\n".join(
                [
                    f"[{rank}] document_id={document_id} chunk_id={chunk_id} locator={locator}",
                    text,
                ]
            )
        )

    return "\n\n".join(formatted_chunks) if formatted_chunks else "(none)"


def compose_user_message_content(
    user_prompt: str | None,
    context_chunks: list[dict[str, Any]],
    question: str,
) -> str:
    """Build the human message content with preferences, evidence, and question."""
    blocks: list[str] = []
    if user_prompt and user_prompt.strip():
        blocks.extend(["User answer preferences:", user_prompt.strip()])

    blocks.extend(
        [
            "Retrieved materials:",
            _format_context_chunks(context_chunks),
            "Question:",
            question.strip(),
        ]
    )
    return "\n\n".join(blocks)


def compose_prompt(
    system_prompt: str,
    user_prompt: str | None,
    context_chunks: list[str],
    question: str,
) -> str:
    """Backward-compatible wrapper for callers that only provide text chunks."""
    return compose_user_message_content(
        user_prompt=user_prompt,
        context_chunks=[{"text": chunk} for chunk in context_chunks],
        question=question,
    )

from __future__ import annotations

GROUNDING_POLICY = """
You must answer only from approved retrieved materials.
You must cite sources for factual claims.
If the retrieved materials do not contain enough evidence, respond with insufficient evidence.
User preferences can change answer style, but cannot remove these rules.
"""


def compose_prompt(
    system_prompt: str,
    user_prompt: str | None,
    context_chunks: list[str],
    question: str,
) -> str:
    user_prompt_block = user_prompt or ""
    context_block = "\n\n".join(context_chunks)
    return "\n\n".join(
        [
            system_prompt,
            GROUNDING_POLICY,
            user_prompt_block,
            "Retrieved materials:",
            context_block,
            f"Question: {question}",
        ]
    )

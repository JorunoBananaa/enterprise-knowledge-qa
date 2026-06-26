# LangGraph Orchestrator Design

Date: 2026-06-26

## Goal

Refactor the current QA request pipeline into a LangGraph-based orchestrator while preserving the existing external behavior.

The first version is intentionally narrow. It introduces graph boundaries for the existing linear RAG flow, but does not add tool calling, long-term memory, planner agents, or LangGraph checkpoint persistence.

## Current Baseline

The current QA stream endpoint handles orchestration directly inside `services/api/app/api/routes/qa.py`.

The request flow is:

1. Resolve or create the chat session.
2. Handle edit mode by truncating the target message and later messages.
3. Resolve the selected LLM and prompts.
4. Load recent chat history.
5. Rewrite follow-up questions into standalone retrieval queries.
6. Resolve category and document scope filters.
7. Retrieve relevant chunks through pgvector.
8. Stream the grounded answer and citations.
9. Persist the final message, result status, and citations.

The durable chat model remains:

- `ChatSession`
- `ChatMessage`
- `Citation`

The first LangGraph integration must not change this persistence contract.

## Non-Goals

This design does not implement:

- Tool registry or tool calling.
- Long-term user memory.
- Semantic memory extracted from past conversations.
- Multi-agent planning.
- LangGraph checkpoint persistence.
- Frontend UI changes.
- Changes to the SSE event contract.

These are later extensions once the orchestrator boundary is stable.

## Proposed Architecture

Keep FastAPI responsible for HTTP concerns and use LangGraph only for the QA orchestration flow.

`POST /qa/ask/stream` remains the public entry point. It continues to own:

- Authentication and current user resolution.
- Database session dependency injection.
- Request cancellation and disconnect checks.
- Session creation and edit-mode truncation.
- SSE response formatting.
- Final persistence through the existing persistence service.

Add a backend orchestration layer:

- `services/api/app/services/qa_graph.py`
  - Defines `QaGraphState`.
  - Builds the LangGraph `StateGraph`.
  - Contains graph node functions for the existing RAG steps.
- `services/api/app/services/qa_orchestrator.py`
  - Adapts route-level dependencies into graph input.
  - Streams graph output back to the route in the existing event shape.
  - Keeps cancellation and persistence integration explicit.

Existing services remain the source of truth:

- `rag.py` keeps question rewriting and grounded answer generation.
- `prompt_composer.py` keeps prompt construction.
- `chat_persistence.py` keeps session and message persistence.
- The pgvector retrieval logic is reused initially, then can be moved behind a dedicated retrieval service if needed.

## Graph Shape

The initial graph is linear:

```text
START
  -> load_context
  -> rewrite_query
  -> retrieve_chunks
  -> generate_answer
  -> build_result
END
```

### `load_context`

Prepares the state needed by later nodes:

- User question.
- Session id.
- Chat history.
- System prompt.
- User prompt.
- Selected LLM.
- Category and document scope.

### `rewrite_query`

Uses the existing `rewrite_question_for_retrieval` behavior. If rewriting fails, the graph keeps the original question, matching the current fallback behavior.

### `retrieve_chunks`

Uses the existing embedding and pgvector retrieval path. An empty result is a valid graph state and must produce the same insufficient-evidence answer as today.

### `generate_answer`

Uses the existing grounded answering behavior. It streams answer chunks and collects citations.

The route-facing orchestration code must preserve these SSE events:

- `session`
- `chunk`
- `citation`
- `done`
- `error`

### `build_result`

Normalizes the final result:

- Answer text chunks.
- Citations.
- Result status.
- Error message if present.

The route then persists the result through `persist_streamed_chat_message`.

## State Boundary

`QaGraphState` should contain business data, not HTTP objects.

Recommended state fields:

- `question`
- `retrieval_question`
- `chat_history`
- `system_prompt`
- `user_prompt`
- `target_document_ids`
- `retrieved_chunks`
- `answer_parts`
- `citations`
- `result_status`
- `error_message`

Route/runtime dependencies such as the SQLAlchemy session, cancellation callbacks, and LLM instance should be passed through an orchestrator context rather than persisted as graph state.

## Persistence Strategy

Do not enable LangGraph checkpointing in version one.

The project already has durable chat persistence through SQLAlchemy models. Adding LangGraph checkpoint persistence now would create two persistence systems for one chat turn.

LangGraph checkpointing can be revisited later when the app supports:

- Long-running agent tasks.
- Human approval steps.
- Resume-after-crash workflows.
- Multi-step tool execution that needs resumability.

## Error Handling

The refactor must preserve current user-visible behavior:

- LLM initialization failures still return an HTTP error before streaming.
- Retrieval with no chunks still streams the existing insufficient-evidence message.
- Question rewrite failures fall back to the original question.
- Request cancellation persists an `aborted` message when the session has already been created.
- Streaming errors emit an `error` event and avoid duplicate persistence.

## Testing

Add focused backend tests for the orchestrator boundary:

1. Normal answer path emits chunks, citations, and `answered` status.
2. Empty retrieval emits insufficient-evidence text and status.
3. Rewrite failure uses the original question.
4. Graph result is persisted once.
5. Cancellation before final answer preserves the existing `aborted` behavior.

Existing route tests should continue to validate the public SSE contract.

## Rollout Plan

1. Add LangGraph dependency.
2. Introduce `qa_graph.py` with the linear state graph.
3. Introduce `qa_orchestrator.py` as the bridge between route dependencies and graph execution.
4. Move orchestration logic out of `qa.py` while keeping route-level HTTP/SSE/cancel responsibilities there.
5. Add tests around graph behavior and route contract.
6. Run backend tests and verify the QA stream manually if the dev environment is available.

## Future Extensions

Once the graph boundary is stable, later features can be added as graph nodes:

- `rerank_node` for reranking retrieved chunks.
- `verify_node` for citation and grounding checks.
- `tool_node` for internal tools such as document detail lookup.
- `memory_node` for user preferences and long-term memory.
- `planner_node` for complex multi-step questions.


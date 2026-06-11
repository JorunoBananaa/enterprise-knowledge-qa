# Enterprise Knowledge QA Design

Date: 2026-06-10

## Summary

Build an enterprise knowledge question-answering system for customer support, presales, and sales teams. The first version is knowledge-management-first: users upload business materials, administrators review and manage those materials, and the Q&A experience only answers from approved indexed content with citations.

The backend uses Python FastAPI and LangChain for retrieval-augmented generation. The system does not generate answers from general model knowledge when approved source material is insufficient.

## Goals

- Provide a managed knowledge library for sales-facing teams.
- Support manual upload of Word, PDF, PowerPoint, and Excel files.
- Organize knowledge by product and module categories.
- Require review before uploaded content becomes available for Q&A.
- Answer user questions strictly from approved source materials.
- Show traceable citations for generated answers.
- Allow administrators to maintain system prompts.
- Allow users to customize personal prompts for answer style and format.
- Support desktop-first web usage with basic mobile compatibility.

## Non-Goals

- External system integrations such as CRM, ticketing, Feishu, or web crawlers.
- Department-level, customer-level, or tenant-level permission isolation.
- Multi-tenant architecture.
- Complex analytics and reporting.
- OCR for images.
- Voice input or output.
- Multi-model routing.
- Production deployment design.
- Code generation or implementation in this phase.

## Users And Roles

### Administrator

Administrators manage the knowledge base and global system behavior.

They can:

- Manage users and roles.
- Manage product and module categories.
- Review user-uploaded documents.
- Approve, reject, archive, delete, or take documents offline.
- Edit, publish, archive, and roll back system prompt versions.
- View operation logs and Q&A trace records.

### Standard User

Standard users are customer support, presales, or sales team members.

They can:

- Upload documents for review.
- View the status of their uploads.
- Ask questions against approved knowledge.
- View answers and citations.
- Maintain a personal prompt for response style and structure.

Standard users cannot delete or modify documents uploaded by other users.

## Product Approach

The selected product approach is knowledge-management-first.

The primary flow starts from the knowledge library: upload, categorize, review, index, and manage documents. The Q&A page remains a core feature, but only reviewed and indexed content is available for retrieval.

This approach favors knowledge quality and operational control over the fastest possible chat-first experience.

## Technical Architecture

Use a standard RAG architecture:

- Frontend web app.
- FastAPI backend.
- LangChain RAG orchestration layer.
- PostgreSQL relational database.
- pgvector vector search.
- File storage for original uploaded documents.
- Document parsing and indexing service.
- LLM and embedding providers behind replaceable interfaces.

Recommended stack:

- Frontend: React or Next.js.
- Backend API: Python FastAPI.
- RAG orchestration: LangChain.
- Database: PostgreSQL.
- Vector store: PostgreSQL with pgvector.
- File storage: local file storage for MVP, with an abstraction that can later point to object storage.
- Document parsing: LangChain document loaders plus file-type-specific parsers.
- LLM access: LangChain chat model interface.
- Embedding access: replaceable embedding provider interface.

pgvector is preferred for the first version because it keeps relational data and vector search in one database, reducing operational complexity. If scale or retrieval quality demands grow, the system can later migrate vector search to Qdrant, Milvus, or another dedicated vector database.

## Module Boundaries

### Auth And RBAC

Owns login, user identity, active session, and administrator or standard-user role checks.

### Knowledge Library

Owns document metadata, categories, upload records, document status, document detail pages, and document lifecycle actions.

### Review Workflow

Owns review state transitions for user-uploaded documents.

Status flow:

- `pending_review`
- `approved`
- `rejected`
- `archived`

Only approved documents can enter the searchable Q&A knowledge base.

### Ingestion Service

Owns document parsing, text cleaning, chunking, and metadata extraction.

The ingestion service produces normalized document chunks with enough metadata to support citation, including document ID, title, file type, page, sheet, slide, section, or another available locator.

### Vector Index Service

Owns embedding generation, vector persistence, index rebuilds, and index status.

Index status:

- `not_indexed`
- `indexing`
- `indexed`
- `failed`

### RAG Service

Owns LangChain-based retrieval and answer generation.

It receives the user question, allowed retrieval scope, active system prompt version, active user prompt version, and document chunks returned by retrieval. It returns an answer, citations, and a result status.

The RAG service must not decide business permissions. Permission and document status filtering happen before retrieval or inside the retriever filter controlled by the application backend.

### Prompt Management

Owns system prompt versions and user prompt settings.

System prompts define global answer rules, citation requirements, refusal behavior, tone constraints, and safety boundaries. User prompts define personal output preferences such as answer style, structure, and terminology.

User prompts cannot override system constraints.

Grounding rules that protect answer correctness are application-level fixed policy. Administrators can edit the system prompt text used for behavior and style, but the application still enforces non-overridable rules such as answering only from approved retrieved materials, requiring citations, and refusing when evidence is insufficient.

### Audit And History

Owns operation logs, review logs, prompt version history, chat sessions, chat messages, and citation records.

## Core Data Flow

### Document Upload And Review

1. A standard user uploads a Word, PDF, PowerPoint, or Excel file.
2. The backend stores the original file and document metadata.
3. The document is created with `pending_review` status.
4. An administrator reviews the document.
5. If rejected, the document remains unavailable for Q&A and stores the rejection reason.
6. If approved, the document becomes eligible for parsing and indexing.

### Indexing

1. The ingestion service parses the approved document.
2. Parsed text is cleaned and split into chunks.
3. Each chunk is stored with citation metadata.
4. Embeddings are generated for each chunk.
5. Vectors are stored in pgvector.
6. The document index status becomes `indexed`.
7. If parsing or embedding fails, the document index status becomes `failed` and the failure reason is recorded.

### Question Answering

1. A logged-in user asks a question.
2. The backend loads the active system prompt and active user prompt, if one exists.
3. The backend restricts retrieval to approved and indexed documents.
4. LangChain retrieves relevant chunks from pgvector.
5. If retrieved evidence is insufficient, the system returns an insufficient-evidence response.
6. If evidence is sufficient, LangChain generates an answer using only retrieved chunks.
7. The response includes citations.
8. The system stores the question, answer, citations, prompt versions, and result status.

## Prompt Design

Prompt composition order:

1. System prompt.
2. Non-overridable safety and grounding rules.
3. User personal prompt.
4. Retrieved source chunks.
5. User question.

System prompt responsibilities:

- Require answers to be based only on retrieved materials.
- Require citations.
- Define refusal behavior when evidence is insufficient.
- Define global tone and answer style.
- Prevent fabrication and unsupported claims.

User prompt responsibilities:

- Preferred answer structure.
- Tone preference.
- Terminology preference.
- Output format preference.

User prompts are allowed to change how the answer is expressed, not what evidence the answer may use.

The non-overridable safety and grounding rules are owned by application code and are not editable through the prompt management UI.

Each Q&A record stores:

- System prompt version.
- User prompt version, if enabled.
- Retrieved chunk IDs.
- Citation records.
- Result status.

## Core Data Model

### User

Fields include ID, account, display name, role, status, created time, and updated time.

### Role

Represents administrator and standard-user roles.

### KnowledgeCategory

Represents product and module categories. Categories may have parent-child hierarchy.

### KnowledgeDocument

Represents uploaded documents.

Fields include title, file type, category, uploader, review status, index status, version, storage location, failure reason, created time, and updated time.

### DocumentChunk

Represents parsed text chunks.

Fields include document ID, chunk text, page or section locator, metadata, vector ID, created time, and updated time.

### ReviewRecord

Represents review actions.

Fields include document ID, reviewer, action, comment, created time.

### PromptTemplate

Represents system prompt versions.

Fields include version, content, status, author, published time, archived time, and rollback source.

Prompt status:

- `draft`
- `active`
- `archived`

### UserPrompt

Represents a user's personal prompt.

Fields include user ID, content, enabled flag, version, created time, and updated time.

### ChatSession

Represents a Q&A session.

### ChatMessage

Represents a user question and assistant answer.

Fields include session ID, user question, answer, result status, insufficient-evidence reason, system prompt version, user prompt version, created time.

Result status:

- `answered`
- `insufficient_evidence`
- `failed`

### Citation

Represents answer citations.

Fields include chat message ID, document ID, chunk ID, page or section locator, quoted text preview, and rank.

### OperationLog

Represents important operations such as upload, review, prompt publish, prompt rollback, document deletion, document archive, and user role changes.

## Pages And Flows

### Login Page

Users log in and enter the application. Navigation reflects the user's role.

### Home And Knowledge Library

Shows document list, category filters, status filters, file type filters, and keyword search.

### Document Upload Page

Allows users to upload Word, PDF, PowerPoint, or Excel files, set title, select product or module category, and submit for review.

### Document Detail Page

Shows document metadata, review status, index status, upload user, review records, and parsed chunk preview when available.

### Review Management Page

Allows administrators to view pending documents and approve or reject them.

### Q&A Page

Allows users to ask questions and receive grounded answers with citations. If the approved knowledge base does not contain enough evidence, the page shows a clear insufficient-evidence answer.

### System Prompt Management Page

Allows administrators to edit, publish, archive, and roll back system prompt versions.

### Personal Prompt Settings Page

Allows users to edit and enable or disable personal prompt preferences.

### User Management Page

Allows administrators to manage users and roles.

### Operation Log Page

Allows administrators to inspect important system changes and trace Q&A behavior.

## Error Handling

- Upload failure: show the failed file and reason; allow retry.
- Unsupported file content: keep the document in failed index state and show the parser failure.
- Review rejection: store and display administrator comments.
- Indexing failure: keep document approved but unavailable for Q&A until re-indexed successfully.
- Retrieval failure: return a user-facing failure message and record diagnostics.
- Insufficient evidence: return a clear refusal instead of a fabricated answer.
- Prompt conflict: system constraints override user prompt instructions.

## Testing Strategy

### Product Acceptance Tests

- Standard user can upload a supported file and see pending review status.
- Administrator can approve or reject uploaded documents.
- Approved and indexed documents are searchable by Q&A.
- Rejected documents are not used by Q&A.
- Archived documents are not used by Q&A.
- Answers include citations when evidence exists.
- The system refuses when evidence is insufficient.
- User prompt changes answer format but cannot disable grounding or citations.
- System prompt version is stored with each answer.

### Backend Tests

- Role permissions for upload, review, delete, archive, and prompt management.
- Document status transitions.
- Index status transitions.
- Prompt composition precedence.
- Retriever filters only include approved indexed documents.
- Citation records are stored correctly.

### RAG Evaluation

- Golden question set for approved documents.
- Tests for unsupported questions that should produce insufficient-evidence responses.
- Citation correctness checks.
- Regression tests after system prompt changes.

## Open Implementation Decisions

These are intentionally deferred to the implementation planning phase:

- Exact authentication mechanism.
- Exact LLM provider.
- Exact embedding model.
- Exact parser libraries for each file type.
- Whether indexing runs synchronously for MVP or through a background worker.
- Whether local file storage or object storage is used for the first runnable version.

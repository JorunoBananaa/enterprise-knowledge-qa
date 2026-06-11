# Enterprise Knowledge QA

Enterprise knowledge question-answering system for customer support, presales, and sales teams.

## MVP Acceptance Flow

1. Start PostgreSQL with `docker compose -f infra/docker-compose.yml up -d`.
2. Start the FastAPI backend from `services/api`.
3. Start the Next.js frontend from `apps/web-app`.
4. Sign in as administrator.
5. Create a product/module category.
6. Sign in as a standard user.
7. Upload a PDF, Word, PowerPoint, or Excel file.
8. Confirm the document is pending review.
9. Sign in as administrator.
10. Approve the document.
11. Confirm the document becomes indexed.
12. Ask a question whose answer exists in the document.
13. Confirm the answer includes citations.
14. Ask a question unsupported by the document.
15. Confirm the system refuses with insufficient evidence.
16. Update personal prompt style.
17. Confirm answer formatting changes while citations remain required.
18. Update system prompt as administrator.
19. Confirm new answers record the active system prompt version.

## Quick Start

### Backend

```bash
cd services/api
pip install -e ".[dev]"
# Start PostgreSQL (see infra/docker-compose.yml)
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd apps/web-app
npm install
npm run dev
```

### Tests

```bash
# Backend tests
cd services/api
python -m pytest -q

# Frontend tests (requires backend running)
cd apps/web-app
npx playwright install chromium
npm test -- --project=chromium
```

## Architecture

- **Backend**: Python FastAPI + SQLAlchemy + LangChain
- **Frontend**: Next.js + React + TypeScript + Tailwind CSS
- **Database**: PostgreSQL + pgvector
- **File Storage**: Local (MVP)

## Tech Stack

- Python, FastAPI, SQLAlchemy, Alembic, PostgreSQL, pgvector, LangChain
- pypdf, python-docx, python-pptx, openpyxl
- Next.js, React, TypeScript, Tailwind CSS, Playwright

# FirstPrincipleAI — PromptBase

Multi-team AI platform that compiles organizational prompt packs into system prompts, routes to multiple LLM providers, and streams structured responses — with document chat, auto mode detection, and Word/PDF export.

## The Problem

Organizations struggle with AI consistency. Teams use generic AI tools where each interaction lacks organizational context, standards, and quality frameworks. Knowledge lives in people's heads, not in the AI.

## The Solution

PromptBase is an **organizational AI operating system**. Teams chat with AI models that automatically follow your organization's rules, standards, and reasoning frameworks.

```
User sends message
  → Loads team's prompt pack (25 markdown instruction files)
  → Auto-detects task mode (analysis, design, implementation, tender...)
  → Loads matching domain modules (IoT, business apps, AI/ML, platform...)
  → Injects uploaded document content
  → Compiles everything into one system prompt
  → Streams response from the team's configured AI model
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Prompt Compiler** | 3-layer prompt pack (core/domain/always) with keyword-based routing, token budgeting, and priority-based trimming |
| **Auto Mode Detection** | Classifies user intent per message — analysis, implementation, tender response, etc. |
| **Multi-Provider LLM** | Ollama, OpenAI, Anthropic, OpenRouter via unified interface |
| **Document Chat** | Upload PDF/DOCX/TXT/CSV — hybrid retrieval (full inject for small docs, RAG for large) |
| **Multi-Team Isolation** | Each team gets its own pack, model config, documents, and conversations |
| **Word/PDF Export** | AI markdown responses converted to structured .docx with tables, headings, lists |
| **Admin Dashboard** | Pack editor, mode manager, team config, provider setup, AI-assisted pack building |

## Architecture

```
React + Vite + Tailwind (Frontend)
    │
    ▼
FastAPI Backend (Python 3.12)
    ├── Auth (JWT, teams, role-based access, invites)
    ├── Prompt Compiler (3-layer assembly, budget, classifier)
    ├── Chat Service (SSE streaming, conversation history)
    ├── Document Pipeline (parse, chunk, pgvector embeddings)
    ├── LLM Providers (Ollama, OpenAI, Anthropic, OpenRouter)
    ├── Export Engine (markdown → DOCX/PDF)
    └── Admin API (pack CRUD, import/export, AI analyzer)
    │
    ├── PostgreSQL 16 + pgvector (data + vector search)
    ├── Redis (Celery task queue)
    └── Celery Worker (document processing)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Celery |
| Database | PostgreSQL 16 + pgvector |
| Cache/Queue | Redis |
| AI Providers | Ollama, OpenAI, Anthropic, OpenRouter |
| Document Processing | PyMuPDF, pdfplumber, python-docx |
| Export | python-docx, mistune |
| Deployment | Docker Compose, NGINX |

## Quick Start

```bash
# 1. Clone and configure
cd promptbase
cp .env.example .env
# Edit .env with your API keys (Ollama works without keys)

# 2. Start services
docker compose -f docker-compose.dev.yml up -d

# 3. Run database migrations
docker compose -f docker-compose.dev.yml exec api alembic upgrade head

# 4. Start frontend
cd frontend && npm install && npm run dev

# 5. Open http://localhost:5173
```

See [`promptbase/README.md`](promptbase/README.md) for detailed setup instructions, API endpoints, prompt pack format, and full project structure.

## What Makes This Different

The **Prompt Compiler** is the core differentiator. No other platform supports:

- **Multi-module prompt packs** — 25 markdown files with 3-layer structure (core/always/domain)
- **Automatic mode detection** — task-specific behavior switching per message
- **Domain routing** — conditional module loading by topic keywords
- **Token budget management** — dynamic calculation adapting to each model's context window
- **Multi-team isolation** — each team gets its own complete configuration

## Documentation

- [`promptbase/README.md`](promptbase/README.md) — Full technical documentation, API reference, project structure
- [`docs/presentation/`](docs/presentation/) — System workflow explanations
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — Design specifications
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — Implementation plans

## License

Proprietary. Internal use only.

# PromptBase

Multi-team AI platform that compiles organizational prompt packs into system prompts, routes to multiple LLM providers, and streams structured responses — with document chat, auto mode detection, and Word/PDF export.

## What It Does

Teams chat with AI models that automatically follow your organization's rules, standards, and reasoning frameworks. Each team gets its own prompt pack, model configuration, and document library.

```
User sends message
  → System loads team's prompt pack (25 markdown instruction files)
  → Auto-detects task mode (analysis, design, implementation, tender...)
  → Loads matching domain modules (IoT, business apps, AI/ML, platform...)
  → Injects uploaded document content
  → Compiles everything into one system prompt
  → Streams response from the team's configured AI model
  → User sees structured output following org standards
```

## Features

- **Prompt Compiler** — 3-layer prompt pack (core/domain/always) with keyword-based routing, token budgeting, and priority-based trimming
- **Auto Mode Detection** — classifies user intent and injects task-specific instructions (analysis, implementation, tender response, etc.)
- **Multi-Provider LLM** — Ollama, OpenAI, Anthropic, OpenRouter via unified interface. Dynamic context detection per model.
- **Document Chat** — upload PDF/DOCX/TXT/CSV, auto-parsed, hybrid retrieval (full inject for small docs, RAG for large)
- **Multi-Team** — each team has its own pack, model, documents, and conversations
- **Word/PDF Export** — AI markdown responses converted to structured .docx with tables, headings, lists. Per-team templates.
- **AI Pack Analyzer** — uses AI to analyze prompt modules and suggest layer, tags, priority
- **Admin Dashboard** — pack editor, mode manager, team config, provider setup, live model loading

## Architecture

```
Frontend (React + Vite + Tailwind)
    │
    ▼
FastAPI Backend
    ├── Auth (JWT, teams, invites)
    ├── Prompt Compiler (3-layer assembly, budget, classifier)
    ├── Chat Service (SSE streaming, conversation history)
    ├── Document Pipeline (parse, chunk, pgvector embeddings)
    ├── LLM Providers (Ollama, OpenAI, Anthropic, OpenRouter)
    ├── Export Engine (markdown → DOCX/PDF)
    └── Admin API (pack CRUD, import/export, AI analyzer)
    │
    ├── PostgreSQL + pgvector (data + vector search)
    ├── Redis (Celery task queue)
    └── Celery Worker (document processing)
```

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 18+
- (Optional) Ollama running locally or remotely

### 1. Clone and configure

```bash
cd promptbase
cp .env.example .env
```

Edit `.env` if you want to set API keys directly:

```env
ANTHROPIC_API_KEY=sk-ant-...    # or
OPENAI_API_KEY=sk-...           # or
OPENROUTER_API_KEY=sk-or-...    # or
OLLAMA_BASE_URL=http://localhost:11434  # default, no key needed
```

### 2. Start backend services

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts: API (port 8000), PostgreSQL + pgvector (5432), Redis (6379), Celery worker.

### 3. Run database migrations

```bash
# From host machine (with Python 3.12+ and venv)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
DATABASE_URL="postgresql+asyncpg://promptbase:promptbase@localhost:5432/promptbase" alembic upgrade head
```

Or from inside the container:

```bash
docker compose -f docker-compose.dev.yml exec api alembic upgrade head
```

### 4. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 (or 5174 if 5173 is busy).

### 5. First-time setup

1. **Register** at `/register`
2. **Promote yourself to super admin:**
   ```bash
   docker compose -f docker-compose.dev.yml exec db \
     psql -U promptbase -c "UPDATE users SET is_super_admin = true WHERE email = 'your@email.com';"
   ```
3. **Configure a provider:** Admin > LLM Providers > Add Provider (e.g., Ollama with your server URL)
4. **Import a prompt pack:** Admin > Prompt Packs > Import ZIP (or create manually)
5. **Create a team:** Admin > Teams > New Team > assign the pack + configure AI model
6. **Chat:** Go to the home page and start chatting

## Project Structure

```
promptbase/
├── docker-compose.yml          # Production deployment
├── docker-compose.dev.yml      # Development (hot reload, exposed ports)
├── .env.example                # Environment variables template
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml          # Python dependencies
│   ├── alembic/                # Database migrations
│   └── app/
│       ├── main.py             # FastAPI app entry point
│       ├── config.py           # Pydantic settings
│       ├── database.py         # SQLAlchemy async engine
│       ├── auth/               # Users, teams, JWT, invites
│       ├── compiler/           # Prompt pack compiler engine
│       │   ├── classifier.py   # Mode + domain keyword detection
│       │   ├── compiler.py     # System prompt assembly
│       │   └── budget.py       # Token budgeting + trimming
│       ├── providers/          # LLM provider abstraction
│       │   ├── base.py         # Abstract interface
│       │   ├── anthropic.py    # Claude
│       │   ├── openai_provider.py  # GPT
│       │   ├── openrouter.py   # OpenRouter
│       │   └── ollama.py       # Ollama (local/remote)
│       ├── documents/          # Upload, parse, chunk, retrieve
│       ├── chat/               # Conversations, SSE streaming
│       ├── export/             # Markdown → DOCX/PDF
│       ├── admin/              # Pack CRUD, import/export, AI analyzer
│       └── workers/            # Celery background tasks
│
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── pages/              # ChatPage, LoginPage, admin/*
│   │   ├── components/         # ChatMain, DocumentUpload, ModeSelector...
│   │   ├── hooks/              # useSSE, useAuth, useDocumentStatus
│   │   ├── contexts/           # AuthContext
│   │   ├── api/                # Axios client with JWT interceptors
│   │   └── types/              # TypeScript interfaces
│   └── vite.config.ts          # Vite + Tailwind + API proxy
│
└── docs/
    ├── superpowers/
    │   ├── specs/              # Design specification
    │   └── plans/              # Implementation plans (backend + frontend)
    └── presentation/           # Workflow explanation document
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, get JWT |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Current user profile |
| GET | `/api/auth/teams` | List my teams |
| POST | `/api/auth/teams` | Create team |
| POST | `/api/auth/teams/{id}/invite` | Generate invite link |
| POST | `/api/auth/invite/{token}/accept` | Join team via invite |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/stream` | Send message, receive SSE stream |
| POST | `/api/chat/debug-compile` | Preview compiled prompt (no LLM call) |
| GET | `/api/chat/conversations/{team_id}` | List conversations |
| GET | `/api/chat/conversations/{team_id}/{id}/messages` | Get messages |

### Documents
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/{team_id}/upload` | Upload file |
| GET | `/api/documents/{team_id}` | List team's documents |
| GET | `/api/documents/{team_id}/{id}` | Get document status |
| DELETE | `/api/documents/{team_id}/{id}` | Delete document |

### Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/export/message/{id}?format=docx` | Export single message |
| GET | `/api/export/conversation/{id}?format=docx` | Export conversation |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/packs` | List prompt packs |
| POST | `/api/admin/packs` | Create pack |
| POST | `/api/admin/packs/import` | Import pack from ZIP |
| GET | `/api/admin/packs/{id}/export` | Export pack as ZIP |
| POST | `/api/admin/packs/{id}/analyze` | AI-analyze modules |
| POST | `/api/admin/packs/{id}/apply-analysis` | Apply AI suggestions |
| GET | `/api/admin/packs/{id}/modules` | List modules |
| POST | `/api/admin/packs/{id}/modules` | Create module |
| PUT | `/api/admin/modules/{id}` | Update module |
| DELETE | `/api/admin/modules/{id}` | Delete module |
| GET | `/api/admin/packs/{id}/modes` | List task modes |
| POST | `/api/admin/packs/{id}/modes` | Create mode |
| GET | `/api/admin/providers` | List LLM providers |
| POST | `/api/admin/providers` | Add/update provider |
| PUT | `/api/admin/providers/{id}` | Edit provider |
| DELETE | `/api/admin/providers/{id}` | Delete provider |
| GET | `/api/admin/providers/{name}/models` | Fetch available models |
| PUT | `/api/admin/teams/{id}/pack` | Assign pack to team |
| GET | `/api/admin/teams/{id}/llm-config` | Get team's LLM config |
| PUT | `/api/admin/teams/{id}/llm-config` | Set team's LLM config |

## Prompt Pack Format

### Manifest (manifest.json)

```json
{
  "version": "2.0.0",
  "core": ["00_START_HERE.md", "01_PROJECT_OVERVIEW.md", "..."],
  "always_append": ["16_ORG_CAPABILITY_MAP.md"],
  "domains": {
    "embedded_iot": ["17_EMBEDDED_IOT.md"],
    "business_apps": ["18_BUSINESS_APPS.md"]
  },
  "modes": [
    {"name": "analysis", "prompt_text": "Focus on gaps, risks..."},
    {"name": "implementation", "prompt_text": "Produce concrete steps..."}
  ]
}
```

### Module Frontmatter

```markdown
---
title: Systems Engineering Embedded IoT Framework
tags: [plc, firmware, sensor, embedded, iot, modbus]
priority: 80
layer: domain
---

Module content here...
```

### Import

ZIP your prompt pack folder with `manifest.json` + markdown files, then upload via Admin > Prompt Packs > Import ZIP.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Celery |
| Database | PostgreSQL 16 + pgvector |
| Cache/Queue | Redis |
| AI Providers | Ollama, OpenAI, Anthropic, OpenRouter (custom abstraction) |
| Document Parsing | PyMuPDF, pdfplumber, python-docx |
| Export | python-docx, mistune, LibreOffice (optional PDF) |
| Deployment | Docker Compose |

## Tests

```bash
cd backend
source .venv/bin/activate
pytest tests/ -v
```

41 tests covering: prompt classifier, token budget, prompt compiler, LLM provider registry, document parser, text chunker, DOCX export renderer.

## License

Internal use.

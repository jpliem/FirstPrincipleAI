# PromptBase — Multi-Team AI Prompt Platform

**Date:** 2026-03-27
**Status:** Design approved, pending implementation plan

## 1. Purpose

PromptBase is a multi-team web platform where each team has its own AI prompt pack (a set of markdown instruction files) that shapes AI responses. End users upload documents, chat with them, and receive structured responses governed by their team's prompt pack — without seeing or managing the prompts themselves. Admins manage packs, teams, models, and configuration through a dashboard.

The system implements a prompt compiler engine that assembles system prompts from layered modules per request, routes to the team's configured LLM provider, streams responses, and exports results to structured Word documents.

## 2. Core Requirements

### Users & Teams
- Multi-tenant: multiple teams, each with their own prompt pack, model config, and users
- Roles: super admin, team admin, team member
- Basic email/password auth, architected for SSO addition later
- Invite-based team joining

### Chat Interface
- Conversational chat powered by the team's prompt pack
- Document upload — users attach files and chat with their contents
- Task mode selector — structured input forms for specific workflows (e.g., "Tender Response", "Architecture Review")
- SSE streaming for real-time token delivery
- Conversation history with auto-generated titles

### Admin Dashboard
- Prompt pack CRUD — create, edit, import/export packs
- Module editor — inline markdown editing with frontmatter support
- Task mode management — prompt text + optional form schema
- Team management — assign packs, configure models, set thresholds
- User management — invite, roles, team assignment
- LLM provider configuration — API keys, endpoints, available models
- Usage logs — token counts per team/user, compiled prompt audit logs

### Document Handling
- Hybrid strategy: small docs injected whole into context, large docs chunked and retrieved via RAG
- Configurable threshold per team (default: 8K tokens)
- Open source parsing: PyMuPDF, pdfplumber, python-docx
- OCR: external microservice hook for scanned docs and images
- Background processing — upload returns immediately, worker processes async

### Export Pipeline
- AI responses stored as markdown
- Export to structured Word document (.docx) via python-docx
- Markdown tables → Word tables with borders, header row styling, auto column widths
- Full markdown mapping: headings, lists, bold/italic, code blocks
- Per-team Word templates (logo, headers/footers, custom styles)
- Export scope: single message, selected messages, or full conversation
- Optional PDF export via LibreOffice headless

### LLM Providers
- Custom abstraction layer using official SDKs (no LiteLLM)
- Anthropic (Claude) — via anthropic SDK
- OpenAI (GPT) — via openai SDK
- OpenRouter — via httpx
- Ollama — via httpx
- Per-team model configuration
- Streaming support across all providers

## 3. Architecture

### Pattern: Modular Monolith with Background Workers

Single FastAPI application with clean internal module boundaries. Document processing runs as async background tasks via Celery + Redis. Frontend is a separate React + Vite SPA. Everything deployed via Docker Compose.

### System Components

```
┌─────────────────────────────────────────────────────────┐
│  NGINX (reverse proxy, SSL, static frontend)            │
├────────────────────────┬────────────────────────────────┤
│  React + Vite (SPA)    │  FastAPI Application           │
│  • Chat interface      │  ┌──────────┐ ┌────────────┐  │
│  • Task forms          │  │ Auth     │ │ Chat       │  │
│  • Doc upload          │  │ Module   │ │ Module     │  │
│  • Admin dashboard     │  ├──────────┤ ├────────────┤  │
│  • Export controls     │  │ Prompt   │ │ Admin      │  │
│                        │  │ Compiler │ │ Module     │  │
│                        │  ├──────────┤ ├────────────┤  │
│                        │  │ Document │ │ Export     │  │
│                        │  │ Module   │ │ Module     │  │
│                        │  ├──────────┤ ├────────────┤  │
│                        │  │ Provider │ │ Workers    │  │
│                        │  │ Layer    │ │ (Celery)   │  │
│                        │  └──────────┘ └────────────┘  │
├────────────────────────┴────────────────────────────────┤
│  PostgreSQL + pgvector  │  Redis (broker + cache)       │
└─────────────────────────┴───────────────────────────────┘
```

### Docker Compose Services

| Service | Image | Role | Port |
|---------|-------|------|------|
| nginx | nginx:alpine | Reverse proxy, static files, SSL | 80/443 (exposed) |
| web | Node build stage | React SPA build → static files to nginx | build only |
| api | python:3.12-slim | FastAPI app (uvicorn) | 8000 (internal) |
| worker | same as api | Celery worker for doc processing | none |
| db | pgvector/pgvector:pg16 | PostgreSQL + pgvector | 5432 (internal) |
| redis | redis:alpine | Celery broker + session cache | 6379 (internal) |

## 4. Prompt Compiler Engine

### Layer Model

The compiler assembles system prompts from three layers:

**Layer A — Core (always loaded, ~12K tokens)**

All 16 base files (00-15) are loaded for every request. These are the non-negotiable operating rules that define how the AI thinks, reasons, executes, and formats output.

Files:
- 00: Start Here / Entry Point
- 01: Project Overview and Instructions
- 02: Core Method and Assumption Taxonomy
- 03: Output Structure and Quality Standard
- 04: Reasoning Modes and Triggers
- 05: Examples and Prompt Library
- 06: Execution Operating Doctrine
- 07: Universal Value Creation and Lifecycle
- 08: Master Artifact Catalog and Gates
- 09: Product System Framework
- 10: System Integrator and Project Owner Framework
- 11: Application Factory and Modular Meta-Model
- 12: AI Automation Agent Hybrid Playbook
- 13: Discovery Engineering Build Test Handover
- 14: Portfolio Program and Governance
- 15: Supersession and Migration Map

**Layer B — Domain modules (selective, ~3-5K tokens each)**

Loaded only when the classifier detects a matching domain in the user's request. These are the expansion files (16-22):

**File 16 (Organizational Capability Map) is always appended** — loaded on every request alongside Layer A, as it provides cross-functional context needed across all domains. Not subject to classification.

Remaining domain modules (17-22) are loaded by classification:

| Module | Triggers on |
|--------|-------------|
| 17: Embedded/IoT Framework | plc, firmware, sensor, iot, embedded, modbus |
| 18: Business Application Suite | erp, crm, ppc, warehouse, qc, production |
| 19: AI/ML/LLMOps Framework | llm, agent, mlops, ai, rag, eval, vision |
| 20: Platform/Cloud/DevSecOps | cloud, devops, deploy, docker, kubernetes |
| 21: Digital Thread & Config Governance | bom, config, revision, traceability |
| 22: Reference Architecture Patterns | solution design, architecture, patterns |

**Layer C — Per-request context (variable)**

- Retrieved document chunks or full injected text
- Task mode prompt
- Conversation history
- User-provided constraints

### Compilation Flow

```
1. CLASSIFY   → keyword match against module use_when tags + task mode detection
2. SELECT     → always load Layer A + matched Layer B modules
3. COMPILE    → assemble in precedence order (see below)
4. BUDGET     → check against model's context limit, trim if needed
5. SEND       → system prompt + messages → LLM provider → stream via SSE
```

### Precedence Order (highest to lowest)

1. Hardcoded safety / platform rules
2. App-level system wrapper
3. Core files (Layer A, files 00-15)
4. Always-append modules (e.g., file 16)
5. Domain modules (Layer B, matched)
6. Task mode prompt
7. Document context (Layer C)
8. Conversation history

If rules conflict, higher-numbered layers yield to lower-numbered layers.

### Token Budget Management

| Model class | Context | Core (Layer A) | Remaining for B+C |
|-------------|---------|----------------|--------------------|
| Claude 3.5+ | 200K | 12K (6%) | ~150K+ |
| GPT-4o | 128K | 12K (9%) | ~80K+ |
| Ollama large (32K) | 32K | 12K (37%) | ~12K |
| Ollama small (8K) | 8K | 12K — OVER | use condensed core |

**Small-context model strategy:**
- Maintain a condensed core — a single compressed version of all 16 files (~3-4K tokens)
- Admin can review/edit the condensed version
- Admin UI warns when a team selects a model too small for the full pack
- Compiler auto-switches to condensed core when model context < threshold (configurable, default 16K)

### Prompt Pack Data Model

**prompt_packs**
- id, name, version, description
- team_id (owner, nullable for shared packs)
- manifest (JSON: core file list, domain mappings, always_append)
- condensed_core (text, nullable — compressed version for small models)
- created_at, updated_at

**prompt_modules**
- id, pack_id (FK)
- filename, title
- layer: core | domain | always
- tags[] (use_when keywords from frontmatter)
- priority (integer, for budget trimming order)
- content (markdown text)
- token_count (pre-computed)
- max_tokens (from frontmatter, nullable)
- sort_order (file number, e.g., 0 for 00_, 17 for 17_)

**task_modes**
- id, pack_id (FK)
- name (analysis, implementation, tender_response, etc.)
- prompt_text (appended to system prompt when mode is active)
- form_schema (JSON, nullable — defines structured input fields)
- sort_order

### Pack Import/Export

**Import:** Admin uploads a ZIP containing `manifest.json` + markdown files. System parses frontmatter from each `.md`, creates pack and module records in DB, saves original files to file storage.

**Export:** Generates a ZIP with `manifest.json` + individual `.md` files with frontmatter. Roundtrip-safe.

**Manual creation:** Admin creates pack in UI, adds modules one by one via markdown editor. Frontmatter fields (tags, priority, layer) editable via form fields alongside the editor.

## 5. Document Pipeline

### Upload Flow

```
User uploads file
  → API saves to file storage, creates document record (status: pending)
  → Dispatches Celery task → returns 202 immediately
  → Frontend polls document status

Worker picks up task:
  1. PARSE:    route by file type
               PDF → PyMuPDF / pdfplumber
               DOCX → python-docx
               CSV/TXT → direct read
               Image / scanned PDF → call OCR microservice
  2. DECIDE:   count tokens
               < threshold → strategy: full_inject, store full text
               ≥ threshold → strategy: rag, proceed to chunk
  3. CHUNK:    split by sections/paragraphs (configurable chunk size)
  4. EMBED:    generate embeddings via team's configured embedding model
  5. STORE:    save vectors to pgvector (document_chunks table)
  6. UPDATE:   document status → ready (or failed with error message)
```

### Retrieval at Chat Time

- **full_inject documents:** full text injected directly into Layer C context
- **rag documents:** pgvector cosine similarity search using the user's message as query, return top-k chunks (configurable, default k=5)
- Documents are scoped to team — users in the same team can share docs within conversations

### Data Model

**documents**
- id, team_id, user_id
- filename, file_path (storage reference)
- file_type, file_size
- status: pending | processing | ready | failed
- error_message (nullable)
- strategy: full_inject | rag
- full_text (nullable — stored when strategy is full_inject)
- token_count
- created_at

**document_chunks**
- id, document_id (FK)
- chunk_index
- content (text)
- embedding (vector — pgvector)
- token_count

## 6. Chat Flow

### Per-Message Request Flow

```
1. User sends message (text + optional document IDs)
2. Load conversation history from DB, trim oldest first to fit budget
3. Retrieve document context:
   - full_inject docs → inject full text
   - rag docs → pgvector similarity search → top-k chunks
4. Prompt Compiler:
   - Load team's pack from DB (cached)
   - Classify request → select Layer B modules
   - Compile system prompt (Layer A + B + mode + doc context)
   - Token budget check against model limit
5. Call LLM Provider:
   - Route to team's configured provider + model
   - Send system_prompt + messages
   - Stream response
6. Stream to frontend via SSE
   - Tokens sent as they arrive
   - Full response saved to messages table on completion
```

### Data Model

**conversations**
- id, team_id, user_id
- title (auto-generated from first message, editable)
- mode (nullable — task mode name)
- created_at, updated_at

**messages**
- id, conversation_id (FK)
- role: user | assistant | system
- content (text — markdown for assistant messages)
- token_count
- created_at

**conversation_documents** (junction table)
- conversation_id, document_id

## 7. LLM Provider Layer

### Interface

All providers implement a common async interface:

```
class LLMProvider:
    async def stream_chat(system_prompt, messages, config) → AsyncIterator[str]
    async def embed(texts, config) → list[list[float]]
    def count_tokens(text) → int
    def max_context_tokens() → int
```

### Implementations

| Provider | SDK | Streaming | Embedding |
|----------|-----|-----------|-----------|
| Anthropic | anthropic (official) | Messages API streaming | voyage / built-in |
| OpenAI | openai (official) | Chat completions streaming | text-embedding-3-small |
| OpenRouter | httpx | OpenAI-compatible streaming | depends on model |
| Ollama | httpx | /api/chat streaming | /api/embeddings |

### Configuration

**llm_providers** (DB table)
- id, name (anthropic, openai, openrouter, ollama)
- base_url (nullable — override for self-hosted)
- api_key (encrypted)
- is_enabled

**team_llm_config** (DB table)
- team_id, provider_id
- chat_model (e.g., "claude-sonnet-4-20250514", "gpt-4o")
- embedding_model (e.g., "text-embedding-3-small")
- max_tokens_per_request
- temperature (default)

## 8. Export Pipeline

### Markdown → Word Document

AI responses are stored as markdown. The export engine converts to structured Word documents:

**Mapping:**

| Markdown | Word Element |
|----------|-------------|
| `# Heading` | Heading 1 |
| `## Heading` | Heading 2 |
| `### Heading` | Heading 3 |
| `**bold**` | Bold run |
| `*italic*` | Italic run |
| `` `code` `` | Monospace run |
| `- item` | Bullet list |
| `1. item` | Numbered list |
| `\| table \|` | Word Table (borders, header row shading, auto column width) |
| ` ``` code block ``` ` | Shaded paragraph, monospace |

**Implementation:** mistune or markdown-it-py parses markdown to AST → custom renderer walks AST and builds Word elements via python-docx.

### Template System

- Per-team `.docx` templates uploaded via admin UI
- Templates define: styles (fonts, colors, heading sizes), logo, headers/footers, page margins
- Export engine applies the team's template, falls back to default
- Stored in file storage alongside documents

### Export Options

- Single message → one document
- Selected messages → combined document with separator
- Full conversation → structured document with user/assistant sections
- Include/exclude metadata header (date, team, model, mode)
- Available as download button on each message and conversation menu

### Optional PDF

- LibreOffice headless installed in Docker image
- `.docx` → `.pdf` conversion via subprocess call
- Only enabled if teams need it (configurable)

## 9. Auth & Multi-Tenancy

### Roles

| Role | Scope | Storage | Permissions |
|------|-------|---------|-------------|
| Super Admin | Platform | `users.is_super_admin` | All — manage all teams, providers, platform settings |
| Team Admin | Team | `team_members.role_in_team` | Manage team's pack, modes, users, model config |
| Member | Team | `team_members.role_in_team` | Chat, upload docs, export — no admin access |

A user can hold different roles in different teams. Super admin is a platform-level flag independent of team membership.

### Auth Flow (v1)

- Email/password registration and login
- JWT access tokens (short-lived) + refresh tokens
- Passwords hashed with bcrypt
- Team join via invite link (generated by team admin)

### SSO-Ready Design

- Auth module isolated behind a service interface
- Login/register routes are separate from session management
- User model has optional `oauth_provider` and `oauth_id` fields (nullable, unused in v1)
- When SSO is added, only the auth module changes — no impact on chat, compiler, or admin

### Data Model

**users**
- id, email, password_hash
- name, is_super_admin (boolean, default false — platform-level flag only)
- oauth_provider (nullable), oauth_id (nullable)
- is_active, created_at

Note: team-level roles (admin | member) are stored in `team_members.role_in_team`, not on the user record. A user can be admin in one team and member in another.

**teams**
- id, name, description
- pack_id (FK to prompt_packs)
- created_at

**team_members** (junction)
- team_id, user_id, role_in_team (admin | member)
- invited_at, joined_at

**invite_links**
- id, team_id, created_by
- token (unique), expires_at, used_by (nullable)

## 10. Project Structure

```
promptbase/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/                    # DB migrations
│   │
│   ├── app/
│   │   ├── main.py                 # FastAPI app, CORS, lifespan
│   │   ├── config.py               # Pydantic settings
│   │   ├── database.py             # SQLAlchemy async + pgvector
│   │   │
│   │   ├── auth/
│   │   │   ├── models.py           # User, Team, TeamMember, InviteLink
│   │   │   ├── routes.py           # Login, register, invite, team CRUD
│   │   │   ├── service.py          # JWT, password hashing, permissions
│   │   │   └── dependencies.py     # get_current_user, require_role
│   │   │
│   │   ├── chat/
│   │   │   ├── models.py           # Conversation, Message
│   │   │   ├── routes.py           # Chat endpoint (SSE), conversation CRUD
│   │   │   └── service.py          # Orchestrates: retrieval → compile → LLM → stream
│   │   │
│   │   ├── compiler/
│   │   │   ├── models.py           # PromptPack, PromptModule, TaskMode
│   │   │   ├── classifier.py       # Keyword matching against module tags
│   │   │   ├── compiler.py         # System prompt assembly (Layer A+B+C)
│   │   │   └── budget.py           # Token counting + trimming logic
│   │   │
│   │   ├── documents/
│   │   │   ├── models.py           # Document, DocumentChunk
│   │   │   ├── routes.py           # Upload, status polling, list, delete
│   │   │   ├── parser.py           # File type routing → text extraction
│   │   │   ├── chunker.py          # Text splitting + embedding generation
│   │   │   └── retriever.py        # pgvector similarity search
│   │   │
│   │   ├── providers/
│   │   │   ├── base.py             # Abstract LLMProvider interface
│   │   │   ├── anthropic.py        # Claude via anthropic SDK
│   │   │   ├── openai_provider.py  # GPT via openai SDK
│   │   │   ├── openrouter.py       # OpenRouter via httpx
│   │   │   ├── ollama.py           # Ollama via httpx
│   │   │   └── registry.py         # Provider lookup by name
│   │   │
│   │   ├── export/
│   │   │   ├── routes.py           # Export endpoints (message, conversation)
│   │   │   ├── renderer.py         # MD AST → python-docx builder
│   │   │   ├── templates/          # Default .docx template
│   │   │   └── pdf.py              # Optional LibreOffice conversion
│   │   │
│   │   ├── admin/
│   │   │   ├── routes.py           # Pack CRUD, import/export, team config
│   │   │   └── importer.py         # ZIP/manifest parser → DB records
│   │   │
│   │   └── workers/
│   │       ├── celery_app.py       # Celery config
│   │       └── tasks.py            # Document processing tasks
│   │
│   └── tests/
│       ├── test_compiler.py
│       ├── test_providers.py
│       ├── test_export.py
│       └── test_documents.py
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── AdminDashboard.tsx
│   │   │   ├── AdminPacks.tsx
│   │   │   ├── AdminModes.tsx
│   │   │   ├── AdminTeams.tsx
│   │   │   ├── AdminUsers.tsx
│   │   │   ├── AdminProviders.tsx
│   │   │   └── AdminUsage.tsx
│   │   ├── components/
│   │   │   ├── ChatMessage.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ConversationList.tsx
│   │   │   ├── DocumentUpload.tsx
│   │   │   ├── DocumentStatus.tsx
│   │   │   ├── ModeSelector.tsx
│   │   │   ├── TaskForm.tsx
│   │   │   ├── PackEditor.tsx
│   │   │   ├── ModuleEditor.tsx
│   │   │   ├── ExportButton.tsx
│   │   │   └── ExportDialog.tsx
│   │   ├── hooks/
│   │   │   ├── useSSE.ts
│   │   │   ├── useAuth.ts
│   │   │   └── useDocumentStatus.ts
│   │   └── api/
│   │       └── client.ts           # Axios/fetch wrapper with auth
│   └── public/
│
└── nginx/
    ├── nginx.conf
    └── nginx.dev.conf
```

## 11. Tech Stack Summary

### Backend
- **Python 3.12** — runtime
- **FastAPI** — web framework (async, OpenAPI docs)
- **SQLAlchemy 2.0** — async ORM
- **Alembic** — database migrations
- **Celery** — background task queue
- **python-docx** — Word document generation
- **mistune** or **markdown-it-py** — markdown parsing to AST
- **PyMuPDF / pdfplumber** — PDF text extraction
- **python-docx** (reading) — DOCX text extraction
- **tiktoken** — token counting (OpenAI models)
- **anthropic** — Claude SDK
- **openai** — OpenAI SDK
- **httpx** — HTTP client for OpenRouter, Ollama, OCR microservice
- **bcrypt** — password hashing
- **python-jose** — JWT handling

### Frontend
- **React 18** — UI framework
- **TypeScript** — type safety
- **Vite** — build tool
- **React Router** — routing
- **TanStack Query** — data fetching + cache
- **Tailwind CSS** — styling

### Infrastructure
- **PostgreSQL 16** + **pgvector** — relational + vector DB
- **Redis** — Celery broker + session/prompt cache
- **Nginx** — reverse proxy + static serving
- **Docker + Docker Compose** — deployment
- **LibreOffice headless** — optional PDF conversion

## 12. Non-Functional Requirements

### Security
- JWT with short-lived access tokens, httpOnly refresh tokens
- API key encryption at rest (Fernet or similar)
- CORS restricted to frontend origin
- Rate limiting on auth endpoints
- File upload size limits (configurable, default 50MB)
- Input sanitization on all user-facing endpoints

### Performance
- Prompt pack loaded once per team, cached in Redis with TTL
- Compiled prompt cached per (pack_version + mode + matched_domains)
- Document embeddings computed once on upload, reused across conversations
- SSE streaming — no buffering delay on LLM responses
- Connection pooling for database (SQLAlchemy async pool)

### Observability
- Structured logging (JSON) for all requests
- Compiled prompt audit log — what was assembled, token counts, modules selected
- Token usage tracking per team and user
- Document processing status and error tracking
- Health check endpoints for all services

## 13. Out of Scope (v1)

- SSO / OAuth integration (designed for, not implemented)
- Horizontal scaling / load balancing (single instance sufficient for v1)
- Real-time collaboration (multiple users in same conversation)
- Prompt pack versioning / rollback (track via updated_at, no full version history)
- Usage-based billing
- Mobile app

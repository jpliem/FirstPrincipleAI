# PromptBase

Organizational prompt-pack platform. Compiles modular markdown instruction packs into per-request system prompts, routes to multiple LLM providers, and delivers structured Word/PDF output — per team, per model, per task.

Chat UI is the delivery surface. The product is the **compiler**.

---

## TL;DR

```mermaid
flowchart LR
    U[User<br/>message] --> CL{Classifier}
    CL -->|mode + domains| CP[Prompt Compiler]
    Pack[(Team's<br/>Prompt Pack<br/>~25 modules)] --> CP
    Docs[(Uploaded<br/>Docs)] --> CP
    CP --> BG[Token Budget<br/>+ trim by priority]
    BG --> PR[Provider Router<br/>Ollama/OpenAI/Anthropic/<br/>OpenRouter]
    PR --> S[SSE stream]
    S --> EX[DOCX / PDF<br/>export]
    S --> U

    classDef compile fill:#1f6feb,color:#fff
    classDef data fill:#6e40c9,color:#fff
    classDef io fill:#238636,color:#fff
    class CL,CP,BG compile
    class Pack,Docs data
    class U,S,EX,PR io
```

---

## System Architecture

```mermaid
flowchart TB
    subgraph FE["Frontend (React + Vite + Tailwind)"]
        Chat[ChatPage]
        Admin[Admin pages<br/>packs, modes, providers, teams]
        Up[Document Upload]
    end

    subgraph API["FastAPI Backend (app/)"]
        Auth[auth/<br/>JWT, teams, invites]
        ChatAPI[chat/<br/>SSE stream]
        DocAPI[documents/<br/>upload, status]
        AdminAPI[admin/<br/>pack CRUD, AI analyzer]
        ExportAPI[export/<br/>md → DOCX/PDF]

        subgraph Comp["compiler/"]
            CLS[classifier.py<br/>mode + domain keywords]
            CMP[compiler.py<br/>3-layer assembly]
            BDG[budget.py<br/>token trim by priority]
        end

        subgraph Prov["providers/"]
            B[base.py abstract]
            OA[openai_provider]
            AN[anthropic]
            OR[openrouter]
            OL[ollama]
            B -.-> OA & AN & OR & OL
        end
    end

    subgraph Workers["Celery Worker"]
        Parse[Parse PDF/DOCX/TXT]
        Chunk[Chunk + Embed]
    end

    subgraph Store["Storage"]
        PG[(PostgreSQL 16<br/>+ pgvector)]
        R[(Redis<br/>queue + cache)]
    end

    Chat <-->|HTTPS + SSE| ChatAPI
    Up --> DocAPI
    Admin <--> AdminAPI

    ChatAPI --> CLS --> CMP --> BDG --> Prov
    DocAPI --> R --> Workers
    Workers --> PG
    Prov -->|stream| ChatAPI
    ExportAPI --> PG

    AdminAPI --> PG
    Auth --> PG
    ChatAPI --> PG
```

---

## The Prompt Compiler

The unique part. Each chat turn rebuilds a fresh system prompt from the team's pack.

```mermaid
flowchart TB
    Msg[User message] --> CLS[Classifier]
    CLS -->|keyword match| Mode[Detected mode<br/>analysis / implementation / tender / ...]
    CLS -->|keyword match| Doms[Detected domains<br/>embedded_iot, business_apps, ai_ml, ...]

    subgraph Pack["Team Prompt Pack (manifest.json)"]
        L1[Core layer<br/>always loaded]
        L2[Domain layer<br/>conditional]
        L3[Always-append<br/>org capability map etc.]
        L4[Modes<br/>per-mode prompt_text]
    end

    Mode --> L4
    Doms --> L2
    L1 --> ASM
    L2 --> ASM
    L3 --> ASM
    L4 --> ASM

    DocCtx[Uploaded doc context<br/>small=full inject<br/>large=RAG snippets] --> ASM

    ASM[Assemble] --> BG{Token budget<br/>fits model ctx?}
    BG -->|over| Trim[Drop lowest-priority<br/>modules first]
    Trim --> BG
    BG -->|fits| Final[Final system prompt]

    Final --> LLM[Provider call]
```

Module frontmatter drives the compiler:

```markdown
---
title: Embedded IoT Framework
tags: [plc, firmware, sensor, modbus]
priority: 80
layer: domain        # core | domain | always_append
---
```

---

## Document Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant API as FastAPI documents/
    participant R as Redis
    participant W as Celery worker
    participant DB as PostgreSQL+pgvector

    U->>API: POST /api/documents/{team}/upload (PDF/DOCX/TXT)
    API->>DB: insert document row (status=pending)
    API->>R: enqueue parse task
    API-->>U: 202 + document_id
    W->>R: pull task
    W->>W: parse (PyMuPDF / pdfplumber / python-docx)
    W->>W: chunk + embed
    W->>DB: store chunks + vectors
    W->>DB: status=ready
    loop hook: useDocumentStatus
        U->>API: GET /api/documents/{team}/{id}
        API->>DB: select status
        API-->>U: status JSON
    end
```

At chat time:
```mermaid
flowchart LR
    Msg[Message refers to doc] --> Size{Doc small?}
    Size -->|yes| Inj[Inject full text]
    Size -->|no| Sim[pgvector similarity search<br/>top-k chunks]
    Inj --> Ctx[Doc context block]
    Sim --> Ctx
    Ctx --> CMP[Compiler]
```

---

## Multi-Team Isolation

```mermaid
flowchart TB
    subgraph T1["Team A"]
        PA[Pack A]
        MA[Model: claude-sonnet-4-6]
        DA[(Docs A)]
        CA[(Convos A)]
    end
    subgraph T2["Team B"]
        PB[Pack B]
        MB[Model: ollama/qwen]
        DB2[(Docs B)]
        CB[(Convos B)]
    end
    subgraph T3["Team C"]
        PC[Pack A reused]
        MC[Model: gpt-5]
        DC[(Docs C)]
        CC[(Convos C)]
    end

    User[Same user, multi-team] --> T1
    User --> T2
    User --> T3
```

Each team has independent: pack assignment, LLM provider+model config, document library, conversation history.

---

## Provider Routing

```mermaid
flowchart LR
    Req[Chat request] --> Reg[Provider Registry]
    Reg -->|by team config| Sel{provider?}
    Sel -->|anthropic| AN[anthropic.py<br/>Claude API]
    Sel -->|openai| OA[openai_provider.py<br/>GPT API]
    Sel -->|openrouter| OR[openrouter.py<br/>unified gateway]
    Sel -->|ollama| OL[ollama.py<br/>local/remote]
    AN & OA & OR & OL -->|async generator| Stream[SSE chunks]
```

Each provider implements the same `base.py` interface: `stream(messages, model, **kwargs) -> AsyncIterator[str]`. Adding a provider = one new file + register.

---

## Export Pipeline

```mermaid
flowchart LR
    Msg[Assistant markdown] --> P[mistune parser]
    P --> AST[Markdown AST]
    AST --> R[DOCX renderer<br/>headings, lists, tables, code]
    R --> Tmpl[Team template<br/>styles, branding]
    Tmpl --> Doc[.docx]
    Doc -->|optional| LO[LibreOffice headless]
    LO --> PDF[.pdf]
```

---

## Components

| Layer | Path | Role |
|---|---|---|
| Frontend | `frontend/src/` | React + Vite + Tailwind, TanStack Query |
| Backend entry | `backend/app/main.py` | FastAPI app |
| Auth | `backend/app/auth/` | JWT, users, teams, invites |
| Compiler | `backend/app/compiler/` | `classifier.py`, `compiler.py`, `budget.py` |
| Providers | `backend/app/providers/` | Anthropic, OpenAI, OpenRouter, Ollama |
| Documents | `backend/app/documents/` | Upload, parse, chunk, retrieve |
| Chat | `backend/app/chat/` | SSE streaming, conversation persistence |
| Export | `backend/app/export/` | Markdown → DOCX/PDF |
| Admin | `backend/app/admin/` | Pack CRUD, import/export ZIP, AI analyzer |
| Workers | `backend/app/workers/` | Celery tasks (doc processing) |
| DB migrations | `backend/alembic/` | Schema versioning |

---

## Quick Start

```bash
cd promptbase
cp .env.example .env
# edit .env — set at least one provider key OR Ollama URL

# 1. backend services
docker compose -f docker-compose.dev.yml up -d
# starts: api (8000), postgres+pgvector (5432), redis (6379), celery worker

# 2. migrations
docker compose -f docker-compose.dev.yml exec api alembic upgrade head

# 3. frontend
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

First-run setup:
```mermaid
flowchart LR
    R[Register] --> SA[Promote to super admin<br/>SQL update]
    SA --> Prov[Add LLM provider]
    Prov --> Pack[Import prompt pack ZIP]
    Pack --> Team[Create team<br/>assign pack + model]
    Team --> Chat[Start chatting]
```

Super admin promotion:
```bash
docker compose -f docker-compose.dev.yml exec db \
  psql -U promptbase -c "UPDATE users SET is_super_admin = true WHERE email = 'you@x.com';"
```

---

## API Surface

| Group | Method | Endpoint |
|---|---|---|
| Auth | POST | `/api/auth/register` `/login` `/refresh` |
| Auth | GET | `/api/auth/me` `/teams` |
| Auth | POST | `/api/auth/teams` `/teams/{id}/invite` `/invite/{token}/accept` |
| Chat | POST | `/api/chat/stream` (SSE) `/debug-compile` |
| Chat | GET | `/api/chat/conversations/{team_id}` `/messages` |
| Docs | POST/GET/DEL | `/api/documents/{team_id}[/{id}]` |
| Export | GET | `/api/export/message/{id}?format=docx` `/conversation/{id}` |
| Admin | * | `/api/admin/{packs,modules,modes,providers,teams}` |

Full table in old README; see `app/main.py` route registration.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TS, Vite, Tailwind, TanStack Query |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 async, Celery |
| DB | PostgreSQL 16 + pgvector |
| Queue | Redis |
| LLMs | Ollama, OpenAI, Anthropic, OpenRouter |
| Doc parse | PyMuPDF, pdfplumber, python-docx |
| Export | python-docx, mistune, LibreOffice (PDF) |
| Deploy | Docker Compose |

---

## Why PromptBase (vs alternatives)

```mermaid
flowchart LR
    subgraph CGPT[ChatGPT / Claude Projects]
        C1[One textbox per project]
        C2[Locked model]
        C3[No team isolation]
    end
    subgraph OWUI[Open WebUI]
        O1[One system prompt per model]
        O2[Single-user focus]
        O3[Pipelines plugins]
    end
    subgraph PB[PromptBase]
        P1[Multi-module layered compiler]
        P2[Multi-provider routing]
        P3[Per-team pack + model + docs]
        P4[Auto mode + domain detection]
        P5[Token budget w/ priority trim]
        P6[Structured DOCX/PDF export]
    end
```

PromptBase is not a ChatGPT clone. The differentiator is: *"how do you make AI consistently follow a multi-file org instruction framework across teams and models, with context-aware routing per message?"*

---

## Prompt Pack Format

```
my_pack/
├── manifest.json
├── 00_START_HERE.md           # core
├── 01_PROJECT_OVERVIEW.md     # core
├── 16_ORG_CAPABILITY_MAP.md   # always_append
├── 17_EMBEDDED_IOT.md         # domain: embedded_iot
└── 18_BUSINESS_APPS.md        # domain: business_apps
```

```json
{
  "version": "2.0.0",
  "core": ["00_START_HERE.md", "01_PROJECT_OVERVIEW.md"],
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

Import via Admin → Prompt Packs → Import ZIP.

---

## Tests

```bash
cd backend && source .venv/bin/activate
pytest tests/ -v
# 41 tests: classifier, budget, compiler, provider registry, doc parser, chunker, DOCX renderer
```

---

## License

Internal use.

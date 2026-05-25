# PromptBase

Organizational prompt-pack platform. Compiles modular markdown instruction packs into per-request system prompts, routes to multiple LLM providers, and delivers structured Word/PDF output — per team, per model, per task.

Chat UI is the delivery surface. The product is the **compiler**.

---

## Problem

Organizations need AI that follows *their* rules — engineering standards, sales playbooks, compliance checklists, internal terminology — consistently across every conversation, every team, every model. The current options all fail:

- **ChatGPT / Claude Projects:** one freeform system prompt textbox per project. No layering, no team isolation, no domain routing, no token budget visibility.
- **Open WebUI / chat front-ends:** great chat, but system prompt is per-model, not per-team, and there's no concept of multi-module instruction packs.
- **DIY prompt sprawl:** instructions copied into individual chats, drifting between teammates, impossible to version, no enforcement.

The actual organizational instruction set is not one prompt — it's 20–30 markdown documents (project overview, capability map, domain frameworks, mode-specific guidance). Stuffing all of that into one system prompt blows the context window. Loading only some of it manually is what humans currently do, and it's the failure point.

## Goal

Build the missing layer between the model and the chat UI:

1. **Modular prompt packs** — 25+ markdown modules with frontmatter (layer, priority, tags), versioned per team.
2. **Per-request compilation** — every message triggers a fresh assembly: core layer always loaded, domain modules conditionally loaded by keyword match, mode-specific overlay added by intent classifier, uploaded docs injected, total trimmed to fit the target model's context window by priority.
3. **Multi-team, multi-provider** — each team picks its pack + LLM provider (Ollama, OpenAI, Anthropic, OpenRouter) + model independently. Same user, multiple teams, no cross-bleed.
4. **Structured output delivery** — markdown responses converted to DOCX/PDF with team styling, because that's how the organization actually consumes the output.

The differentiator is the compiler, not the chat. *"How do you make AI consistently follow a multi-file instruction framework across teams and models with auto-routing per message?"*

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

## Screenshots

| | |
|---|---|
| **Chat with streaming response (Engineering team)** | **LLM provider registry** |
| ![chat](docs/screenshots/07-streaming-mid.png) | ![providers](docs/screenshots/11-admin-providers.png) |
| **Prompt pack admin — 11 packs, 296 modules** | **Team config — pack assignment + LLM model** |
| ![packs](docs/screenshots/10-admin-packs.png) | ![teams](docs/screenshots/12-admin-teams.png) |

Captured locally against an OpenAI-compatible llama.cpp endpoint serving a Qwen model. Provider URL in screenshot is a placeholder; the real value is set per deployment via `Admin → LLM Providers → Add`.

---

## Sample Walkthrough

A real chat turn in the **Engineering** team using a 25-module Intercon prompt pack against a remote llama.cpp server.

### Setup state

- Team: `Engineering`
- Pack: `intercon-v2` (25 modules: 7 core, 12 domain, 6 mode overlays)
- Provider: `openai` type pointing at `https://llamacpp.example.com/v1`
- Model: `qwen3.5:27b` (262k ctx)
- Uploaded doc: `cold_chain_RFQ.pdf` (8 pages, parsed + chunked)

### User message

> *"Design an architecture for a cold-chain temperature sensor that uploads via LoRaWAN every 5 minutes, references the attached RFQ for constraints."*

### Trace (server timing in ms)

```
0ms     /api/chat/stream                User message hits SSE endpoint
3ms     Save user message               Persist to conversations table
15ms    Load team LLM config            Engineering → Ollama-compatible, qwen3.5:27b, 262k ctx
65ms    Provider /api/show              Confirm ctx size 262144 (cached after first call)
70ms    Load prompt pack                25 modules from DB
71ms    Classifier                      message keywords: "sensor", "LoRaWAN", "cold chain", "architecture"
                                        → mode = "design"
                                        → domains = ["embedded_iot"]
75ms    Compiler — assemble system prompt
        Core (always):
          00_START_HERE.md                priority=100  layer=core
          01_PROJECT_OVERVIEW.md          priority=100  layer=core
          02_HOUSE_RULES.md               priority=100  layer=core
          ...
        Always-append:
          16_ORG_CAPABILITY_MAP.md        priority=90   layer=always_append
        Domain (matched):
          17_EMBEDDED_IOT.md              priority=80   layer=domain (tags: sensor, lorawan, embedded)
        Mode overlay:
          modes["design"].prompt_text     → "Produce a layered architecture diagram + BOM + risk register..."
        Document context:
          cold_chain_RFQ.pdf              4 chunks (top-k semantic match), 1800 tokens
120ms   Token budget
        Assembled: 38,400 tokens (system) + 4,200 (history) + 1,800 (doc) = 44,400
        Target ctx: 262,144 → fits, no trim
122ms   Provider call                    qwen3.5:27b @ llamacpp endpoint, stream=true
...     SSE streaming back to client     chunks flushed to /api/chat/stream subscribers
8.4s    Stream complete                  ~3,200 output tokens
8.5s    Persist assistant message        conversations + messages tables
```

### Output (assistant response, abbreviated)

```markdown
# Cold-Chain Temperature Sensor — Architecture

## 1. Constraints (extracted from RFQ)
- Operating range: -40°C to +25°C
- Battery life: ≥ 3 years on 2× AA
- Compliance: WHO PQS E003/RF05
...

## 2. Hardware Block Diagram
| Block | Component | Rationale |
|---|---|---|
| Sensor | SHT45 | ±0.1°C, low power |
| MCU | STM32WL55 | Integrated LoRa, sub-mA sleep |
| Storage | 64Mbit SPI NOR | Buffer 90 days at 5-min interval |
...
## 3. Data Flow (LoRaWAN Class A)
...
## 4. Risk Register
...
## 5. Recommended Next Steps
```

### Why the output is structured this way

The output sections (Constraints, Block Diagram, Data Flow, Risk Register, Next Steps) come from `17_EMBEDDED_IOT.md` — the domain module loaded only because the classifier matched IoT keywords. A different team using the same model with a different pack gets a totally different shape.

The constraints come from `cold_chain_RFQ.pdf` because pgvector retrieval surfaced 4 chunks at compile time, injected before the assistant ever started reasoning. No "function call to read document" was needed.

### Export

User clicks **Export → DOCX**. Server:
1. Loads message markdown
2. mistune parses → AST
3. DOCX renderer walks AST, applies team template (heading styles, table styles, branding)
4. Returns `.docx` file

User opens in Word — sections are real Heading 1/2/3, table is a real Word table, code blocks are styled code.

### Debug — see compiled prompt

`POST /api/chat/debug-compile` with the same payload returns:
```json
{
  "system_prompt": "<full assembled text>",
  "loaded_modules": ["00_START_HERE.md", "01_PROJECT_OVERVIEW.md", "...", "17_EMBEDDED_IOT.md"],
  "mode": "design",
  "domains": ["embedded_iot"],
  "tokens": {"system": 38400, "history": 4200, "documents": 1800, "total": 44400, "ctx_limit": 262144},
  "trimmed": []
}
```

Useful when an assistant response disappoints — first place to look is whether the right modules loaded.

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

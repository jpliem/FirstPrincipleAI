# PromptBase — System Workflow Explained

**Version:** 1.0 | **Date:** 2026-03-28 | **Platform:** PromptBase AI Prompt Platform

---

## 1. What PromptBase Is

PromptBase is an internal AI platform that makes AI models follow your organization's specific rules, standards, and reasoning frameworks — automatically, invisibly, on every interaction.

### The Problem It Solves

When employees use AI tools directly (ChatGPT, Claude, etc.), every person gets a generic AI that:

- Doesn't know your company's engineering standards
- Doesn't follow your quality framework
- Gives inconsistent output across teams
- Requires each person to manually write detailed prompts every time
- Has no institutional knowledge about your processes

### What PromptBase Does

PromptBase sits between your users and the AI model. Before every user message reaches the AI, the system automatically injects a carefully structured **instruction set** (called a Prompt Pack) that tells the AI:

- How to reason about problems (first-principles methodology)
- What quality standards to follow
- How to structure output
- What domain expertise to apply
- What task mode to operate in

**The user just types a normal question. The system handles the rest.**

---

## 2. System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                           │
│                                                                  │
│   ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│   │  Chat Page   │  │  Admin Panel  │  │  Document Upload   │    │
│   │  (React SPA) │  │  (React SPA)  │  │  (Drag & Drop)     │    │
│   └──────┬───────┘  └──────┬────────┘  └────────┬───────────┘    │
│          │                 │                     │                │
└──────────┼─────────────────┼─────────────────────┼────────────────┘
           │                 │                     │
           ▼                 ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                      FASTAPI BACKEND                             │
│                                                                  │
│   ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│   │   Auth   │ │   Prompt   │ │  Document  │ │    Export     │  │
│   │  Module  │ │  Compiler  │ │  Pipeline  │ │   (DOCX/PDF) │  │
│   └──────────┘ └────────────┘ └────────────┘ └──────────────┘  │
│   ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│   │   Chat   │ │    LLM     │ │   Admin    │ │   Celery     │  │
│   │  Service │ │  Provider  │ │   Routes   │ │   Workers    │  │
│   └──────────┘ └────────────┘ └────────────┘ └──────────────┘  │
│                                                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐  ┌──────────────┐  ┌──────────┐
     │PostgreSQL│  │    Redis     │  │  Ollama  │
     │+pgvector │  │ (task queue) │  │(AI model)│
     └──────────┘  └──────────────┘  └──────────┘
```

### Components

| Component | Role | Technology |
|-----------|------|------------|
| **Frontend** | User interface — chat, admin, document upload | React 18 + TypeScript + Tailwind CSS |
| **Backend API** | Core logic — auth, prompt compilation, chat orchestration | Python FastAPI (async) |
| **Prompt Compiler** | Assembles system prompt from pack modules per request | Custom Python module |
| **LLM Provider Layer** | Unified interface to multiple AI model providers | Custom abstraction (Ollama, OpenAI, Anthropic, OpenRouter) |
| **Document Pipeline** | Upload, parse, chunk, embed documents for chat | Celery workers + PyMuPDF + pgvector |
| **Export Engine** | Convert AI responses (markdown) to Word/PDF documents | python-docx + LibreOffice |
| **PostgreSQL + pgvector** | All data storage + vector embeddings for document search | PostgreSQL 16 with pgvector extension |
| **Redis** | Background task queue for document processing | Redis (Celery broker) |
| **Docker Compose** | Deployment — all services in containers | Docker |

---

## 3. The Prompt Pack: Your Organization's AI Brain

### What Is a Prompt Pack?

A Prompt Pack is a collection of markdown files that define how the AI should think, reason, and respond. It is the organization's **codified intelligence** — rules, standards, and frameworks that every AI interaction must follow.

### Current Pack: Intercon v2

**25 modules** organized in 3 layers:

#### Layer A — Core (Always Loaded): 16 modules, ~11,400 tokens

These load on **every single request**, regardless of what the user asks. They are non-negotiable operating rules.

| # | Module | Purpose | Tokens |
|---|--------|---------|--------|
| 00 | Start Here | Defines project scope — engineering, software, AI, business ops | 950 |
| 01 | Project Overview & Instructions | Purpose statement and execution-grade output requirements | 766 |
| 02 | Core Method & Assumption Taxonomy | First-principles methodology — 10-layer decomposition method | 1,029 |
| 03 | Output Structure & Quality Standard | Default response format — sections, structure, quality rules | 564 |
| 04 | Reasoning Modes & Triggers | Different reasoning approaches for different task types | 623 |
| 05 | Examples & Prompt Library | Reusable prompt patterns and templates | 638 |
| 06 | Execution Operating Doctrine | How to plan, execute, verify, and deliver | 688 |
| 07 | Universal Value Creation & Lifecycle | Lifecycle models for products and projects | 823 |
| 08 | Master Artifact Catalog & Gates | Document types, quality gates, and approval stages | 796 |
| 09 | Product System Framework | Product development methodology | 764 |
| 10 | System Integrator & Project Owner Framework | SI delivery and project governance roles | 641 |
| 11 | Application Factory & Modular Meta-Model | Modular software application design patterns | 724 |
| 12 | AI Automation Agent Hybrid Playbook | When to use AI vs automation vs manual | 596 |
| 13 | Discovery Engineering Build Test Handover | Full delivery lifecycle: discover → engineer → build → test → hand over | 746 |
| 14 | Portfolio Program & Governance | Multi-project governance and portfolio management | 481 |
| 15 | Supersession & Migration Map | Version control and migration between framework versions | 553 |

#### Layer A+ — Always Append: 1 module, ~600 tokens

Appended after core on every request.

| # | Module | Purpose | Tokens |
|---|--------|---------|--------|
| 16 | Organizational Capability Map | Maps the organization into capability domains (engineering, business apps, AI, platform, field delivery) so AI knows your company structure | 592 |

#### Layer B — Domain Modules (Loaded On-Demand): 8 modules, ~3,600 tokens

These load **only when the user's message matches their topic**. Keyword-based matching.

| # | Module | Triggers When User Mentions | Tokens |
|---|--------|-----------------------------|--------|
| 17 | Systems Engineering Embedded IoT | PLC, firmware, sensor, IoT, embedded, modbus | 539 |
| 18 | Business Application Suite | ERP, CRM, PPC, warehouse, QC, production | 601 |
| 19 | Data AI ML LLMOps | LLM, agent, RAG, AI, ML, eval, vision | 477 |
| 20 | Platform Cloud DevSecOps | cloud, devops, deploy, docker, kubernetes | 411 |
| 21 | Digital Thread & Config Governance | BOM, config, revision, traceability | 471 |
| 22 | Reference Architecture Patterns | solution design, architecture, patterns | 479 |
| 98 | Gap Analysis & Upgrade Notes | Internal reference for pack evolution | 278 |
| 99 | Intercon AI Upgrade Summary | Upgrade history and decisions | 350 |

### Why 3 Layers?

**Token economy.** AI models have a context window — a maximum amount of text they can process at once. Loading all 25 modules every time would waste tokens on irrelevant content. The layered approach means:

- A question about PLC firmware loads the embedded/IoT module but NOT the business apps module
- A question about ERP configuration loads the business apps module but NOT the embedded module
- A generic question loads only core — no domain modules needed

**Current token budget for qwen3.5:27b (262,144 context):**

```
Available context:        262,144 tokens
Core + Always loaded:     ~12,000 tokens  (4.6% of context)
+ 1 domain module:           ~500 tokens  (0.2%)
+ mode prompt:                ~80 tokens  (0.03%)
+ document (131KB PDF):    ~2,400 tokens  (0.9%)
────────────────────────────────────────────────
Total system prompt:      ~15,000 tokens  (5.7%)
Remaining for response:  ~247,000 tokens  (94.3%)
```

---

## 4. Task Modes: Automatic Behavior Switching

### What Are Modes?

Modes are **task-specific instruction overlays**. They don't change WHAT rules the AI follows (that's the core pack) — they change HOW the AI approaches the specific task.

Think of it as: Core pack = the engineer's education. Mode = the specific job they're doing right now.

### How Mode Detection Works

When a user sends a message, the classifier scans the text for keywords and automatically selects the appropriate mode:

```
User types: "Analyze the server tender spec for compliance gaps"
                │
                ▼
         ┌─────────────┐
         │  Classifier  │
         │              │
         │ "Analyze" ──→ analysis keywords match
         │ "gaps"    ──→ analysis keywords match
         │ "tender"  ──→ tender_response keywords match
         │ "compliance" → analysis keywords match
         │              │
         │ Score:       │
         │  analysis: 3 │  ← highest score wins
         │  tender:   1 │
         │              │
         │ Result:      │
         │  analysis    │
         └──────┬───────┘
                │
                ▼
         Mode prompt injected:
         "Focus on objective analysis. Identify gaps,
          risks, assumptions, and decision quality.
          Challenge weak reasoning. Quantify where
          possible."
```

### The 6 Configured Modes

| Mode | Auto-Triggers On | What It Tells The AI |
|------|-------------------|---------------------|
| **analysis** | analyze, review, assess, evaluate, gap, audit, compare, investigate | Focus on objective analysis. Identify gaps, risks, assumptions, and decision quality. Challenge weak reasoning. Quantify where possible. |
| **solution_design** | design, architect, propose, solution, blueprint | Produce architecture, scope definition, module breakdown, interfaces, BOM where applicable, risk register, and phased rollout plan. Justify design decisions with trade-off analysis. |
| **implementation** | implement, build, create, develop, code, write, set up | Produce concrete implementation steps, file changes, API schemas, database migrations, test plans, and rollout order. Be specific enough that another engineer can execute without further clarification. |
| **tender_response** | tender, RFP, RFQ, proposal, bid, quotation, compliance matrix | Optimize for compliance with tender requirements. Structure response with scope clarity, explicit exclusions, stated assumptions, pricing structure considerations, and handover obligations. Flag any requirement that cannot be met. |
| **architecture_review** | architecture review, tech debt, refactor assessment | Review the architecture for correctness, scalability, security, maintainability, and alignment with requirements. Identify technical debt, single points of failure, and missing concerns. Rate severity of findings. |
| **business_process** | process, workflow, procedure, SOP, operating model | Map the process end-to-end. Identify inputs, outputs, decision points, handoffs, and automation opportunities. Flag bottlenecks and compliance gaps. Suggest improvements with effort-impact ranking. |

### Mode + No Mode

If the user's message doesn't match any mode keywords (e.g., "Hello" or "Summarize this"), **no mode is applied**. The AI uses only the core pack rules — still structured, still following standards, but without a specific task focus.

Users can also **manually override** the auto-detection by selecting a mode from the dropdown in the chat sidebar.

---

## 5. Document Pipeline: Upload → Process → Chat

### Overview

Users upload documents (PDF, DOCX, TXT, CSV) which are processed and made available for the AI to reference during chat.

### Processing Flow

```
User drops file    ┌──────────────────────────────────────────────┐
in upload zone ──→ │  API receives file                           │
                   │  • Save to storage                           │
                   │  • Create DB record (status: pending)        │
                   │  • Dispatch background worker                │
                   │  • Return immediately (HTTP 202)             │
                   └──────────────┬───────────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────────────────────┐
                   │  CELERY WORKER (background)                  │
                   │                                              │
                   │  Step 1: PARSE                               │
                   │  • PDF → PyMuPDF extracts text               │
                   │  • DOCX → python-docx extracts paragraphs    │
                   │  • CSV/TXT → direct read                     │
                   │  • Images/scanned → OCR microservice          │
                   │                                              │
                   │  Step 2: COUNT TOKENS                        │
                   │  • Estimate token count (~4 chars/token)     │
                   │                                              │
                   │  Step 3: DECIDE STRATEGY                     │
                   │  • If tokens ≤ 8,000 → FULL INJECT           │
                   │    (store full text, inject entirely)         │
                   │  • If tokens > 8,000 → RAG                   │
                   │    (chunk, embed, retrieve relevant parts)    │
                   │                                              │
                   │  Step 4: STORE                               │
                   │  • Full inject: save text to DB              │
                   │  • RAG: save chunks + vector embeddings      │
                   │                                              │
                   │  Step 5: UPDATE STATUS → ready               │
                   └──────────────────────────────────────────────┘
```

### Two Retrieval Strategies

| Strategy | When | How It Works | Pros | Cons |
|----------|------|-------------|------|------|
| **Full Inject** | Document ≤ 8,000 tokens (~32KB text) | Entire document text inserted into system prompt | AI sees complete document, no information loss | Uses more context tokens |
| **RAG** | Document > 8,000 tokens | Document chunked → embedded → stored as vectors. At chat time, user's question is embedded, top-5 most similar chunks retrieved | Scales to massive documents | May miss relevant sections if question doesn't match semantically |

### Real Example

```
File: "Spesifikasi Teknis Server Pabrik BWI.pdf"
Size: 134,125 bytes (131 KB)
Extracted tokens: 2,403
Strategy: full_inject (under 8,000 threshold)
Processing time: ~3 seconds
Status: ready ✓

→ When user chats with this document attached, all 2,403 tokens
  are injected into the system prompt under "## Reference Documents"
```

---

## 6. The Prompt Compiler: The Core Engine

### What It Does

The Prompt Compiler is the brain of the system. On every chat message, it:

1. Reads the user's message
2. Decides what modules to load
3. Decides what mode to apply
4. Retrieves relevant document content
5. Assembles everything into one coherent system prompt
6. Checks it fits within the model's context window
7. Sends it to the AI

### Compilation Process (Detailed)

```
                    ┌─────────────────┐
                    │  User Message    │
                    │  + Team Config   │
                    │  + Documents     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   STEP 1:       │
                    │   CLASSIFY      │
                    │                 │
                    │ • Scan message  │
                    │   for keywords  │
                    │ • Match against │
                    │   domain tags   │
                    │ • Score mode    │
                    │   keywords      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   STEP 2:       │
                    │   SELECT        │
                    │                 │
                    │ • Always: 16    │
                    │   core files    │
                    │ • Always: file  │
                    │   16 (org map)  │
                    │ • Conditional:  │
                    │   matched domain│
                    │   modules       │
                    │ • Mode prompt   │
                    │   if detected   │
                    │ • Document text │
                    │   or RAG chunks │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   STEP 3:       │
                    │   COMPILE       │
                    │                 │
                    │ Assemble in     │
                    │ precedence      │
                    │ order:          │
                    │                 │
                    │ 1. Safety       │
                    │ 2. Core (00-15) │
                    │ 3. Always (16)  │
                    │ 4. Domain mods  │
                    │ 5. Mode prompt  │
                    │ 6. Documents    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   STEP 4:       │
                    │   BUDGET CHECK  │
                    │                 │
                    │ Context: 262K   │
                    │ Used:    ~15K   │
                    │ History: varies │
                    │ Remaining: calc │
                    │                 │
                    │ If over budget: │
                    │ • Trim lowest-  │
                    │   priority      │
                    │   modules first │
                    │ • Then trim     │
                    │   documents     │
                    │ • Core never    │
                    │   trimmed       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   STEP 5:       │
                    │   SEND TO LLM   │
                    │                 │
                    │ system_prompt:  │
                    │   [compiled]    │
                    │ messages:       │
                    │   [history +    │
                    │    new message] │
                    │ max_tokens:     │
                    │   [dynamic]     │
                    └─────────────────┘
```

### Precedence Rules

When instructions in different modules conflict, the compiler enforces this priority (highest first):

```
Priority 1 (highest): Safety rules — never override
Priority 2: Explicit task constraints from the user
Priority 3: Domain-specific module rules
Priority 4: Mode prompt instructions
Priority 5: Core framework general rules
Priority 6 (lowest): Default behavior
```

### Token Budget — Dynamic Calculation

The system dynamically calculates how many tokens are available for the AI response:

```
Model context window:          262,144 tokens
─ System prompt (compiled):   - 15,004 tokens
─ Conversation history:       -  2,000 tokens (example: 3 previous messages)
─ User's current message:     -     50 tokens
─ Safety buffer:              -    256 tokens
════════════════════════════════════════════
Available for AI response:    244,834 tokens

max_tokens = min(team_config.max_tokens, available)
           = min(25,000, 244,834)
           = 25,000 tokens
```

This means:
- **Small model (8K context)**: System detects the pack won't fit → switches to condensed core (~3K tokens)
- **Medium model (32K context)**: Full core loads, 1-2 domain modules, decent response length
- **Large model (262K context)**: Everything loads with room to spare — massive documents + long responses

---

## 7. Chat Flow: Complete Request Lifecycle

### What Happens When a User Sends a Message

```
TIME    COMPONENT         ACTION
─────   ─────────         ──────

0ms     Browser           User clicks Send
                          → POST /api/chat/stream

5ms     Auth Module       Decode JWT → verify user → check team membership

10ms    Chat Service      Create/resume conversation
                          Save user message to DB

15ms    LLM Config        Load team's provider config from DB
                          Team: "Engineering"
                          Provider: Ollama
                          Model: qwen3.5:27b
                          Base URL: https://localhost/

65ms    Context Fetch     Query Ollama /api/show for model context size
                          → 262,144 tokens (cached after first call)

70ms    Pack Loader       Load Intercon v2 pack from DB
                          → 25 modules, 6 modes

71ms    Classifier        Scan user message for keywords
                          Mode detected: "analysis"
                          Domains matched: ["digital_thread"]

75ms    Doc Retriever     Load attached document text
                          PDF "Server Spec" → 2,403 tokens (full inject)

77ms    Compiler          Assemble system prompt:
                          Safety wrapper + 16 core + file 16 + file 21
                          + analysis mode prompt + document text
                          = 15,004 tokens

78ms    Budget Check      262,144 - 15,004 - 0 (history) - 256 = 246,884
                          max_tokens = min(25,000, 246,884) = 25,000
                          Nothing trimmed ✓

79ms    SSE Start         Send metadata event to browser:
                          {conversation_id, mode_detected: "analysis",
                           modules_loaded: 18, prompt_tokens: 15004}

80ms    Ollama Call        POST /api/chat (streaming)
                          System prompt: 60,059 characters
                          Messages: [user message]

~200ms  First Token       Ollama starts generating
                          → SSE: "data: #\n\n"
                          → SSE: "data:  Analysis\n\n"
                          → SSE: "data: :\n\n"

5-30s   Streaming         Tokens arrive one at a time
                          Browser renders markdown in real-time

~30s    Complete          Ollama finishes generating
                          → SSE: "data: [DONE]\n\n"

~30.1s  Save Response     Full response saved to messages table
                          Token count recorded for usage tracking

~30.2s  Browser           Stream ends
                          Conversation list refreshed
                          Header shows: "analysis mode · 18 modules · 15004 tokens"
```

### Conversation Continuity

On follow-up messages in the same conversation:

```
Message 1: "Analyze the server spec for gaps"
  → System prompt compiled fresh
  → No history (first message)

Message 2: "What about redundancy concerns?"
  → System prompt compiled fresh (re-classifies message)
  → History includes: Message 1 (user) + Message 1 (assistant)
  → Mode re-detected: still "analysis"
  → Same documents still attached

Message 3: "Now design a solution for the gaps you found"
  → System prompt compiled fresh
  → History includes: Messages 1-2 (both sides)
  → Mode re-detected: "solution_design" (keyword "design")
  → AI shifts behavior: now produces architecture, not analysis
```

**Key insight:** The prompt is **recompiled on every message**. The mode and domain modules can change mid-conversation as the user's intent evolves.

---

## 8. Multi-Team Architecture

### How Teams Work

```
┌─────────────────────────────────────────────────────┐
│                    PLATFORM                          │
│                                                      │
│  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │ Team:            │  │ Team:                    │  │
│  │ "Engineering"    │  │ "Sales"                  │  │
│  │                  │  │                          │  │
│  │ Pack: Intercon v2│  │ Pack: Sales Engineering  │  │
│  │ Model: qwen3.5   │  │ Model: gpt-4o           │  │
│  │ Provider: Ollama │  │ Provider: OpenAI         │  │
│  │                  │  │                          │  │
│  │ Users:           │  │ Users:                   │  │
│  │ • Jonathan (admin)│  │ • Sarah (admin)          │  │
│  │ • Ali (member)   │  │ • Mike (member)          │  │
│  │ • Dewi (member)  │  │ • Lisa (member)          │  │
│  └─────────────────┘  └─────────────────────────┘  │
│                                                      │
│  Each team has:                                      │
│  • Its own prompt pack (different AI behavior)       │
│  • Its own AI model (different provider/model)       │
│  • Its own documents (not shared across teams)       │
│  • Its own conversation history                      │
│  • Its own task modes                                │
└─────────────────────────────────────────────────────┘
```

### User Roles

| Role | Scope | Can Do |
|------|-------|--------|
| **Super Admin** | Platform-wide | Everything — manage all teams, providers, packs, users |
| **Team Admin** | Within their team | Manage team's pack, modes, model config, invite members |
| **Team Member** | Within their team | Chat, upload documents, export — no admin access |

---

## 9. Export Pipeline: AI Output → Professional Documents

### How Export Works

```
AI Response (Markdown)
    │
    ▼
┌──────────────────────────────┐
│  Markdown Parser (mistune)   │
│  Parse to Abstract Syntax    │
│  Tree (AST)                  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  DOCX Renderer (python-docx) │
│                              │
│  # Heading    → Heading 1    │
│  ## Heading   → Heading 2    │
│  **bold**     → Bold run     │
│  *italic*     → Italic run   │
│  - item       → Bullet list  │
│  1. item      → Numbered list│
│  | table |    → Word Table   │
│  ```code```   → Monospace    │
│                              │
│  + Team template applied:    │
│    Logo, headers, footers,   │
│    custom fonts & colors     │
└──────────────┬───────────────┘
               │
               ▼
        ┌──────────────┐
        │  .docx file  │
        │  (download)  │
        └──────┬───────┘
               │ (optional)
               ▼
        ┌──────────────┐
        │  LibreOffice  │
        │  → .pdf file  │
        └──────────────┘
```

### Export Scope Options

- **Single message** → One document with that message's content
- **Full conversation** → Structured document with all user/assistant messages

---

## 10. LLM Provider Abstraction

### How Multiple Providers Work

```
┌──────────────────────────────────────────────────┐
│           PROVIDER ABSTRACTION LAYER              │
│                                                    │
│   Unified Interface:                               │
│   • stream_chat(system_prompt, messages, config)   │
│   • embed(texts, config)                           │
│   • count_tokens(text)                             │
│   • max_context_tokens(model)                      │
│                                                    │
├──────────────┬──────────────┬────────────────────┤
│  Anthropic   │   OpenAI     │   OpenRouter       │
│  Claude 4    │   GPT-4o     │   Any model via    │
│  Sonnet/Opus │   GPT-4-mini │   unified API      │
│              │              │   (100+ models)     │
│  SDK:        │  SDK:        │  Protocol:          │
│  anthropic   │  openai      │  httpx (OpenAI-     │
│              │              │  compatible)        │
├──────────────┴──────────────┴────────────────────┤
│                    Ollama                          │
│  Self-hosted / remote server                      │
│  Any open-source model: Llama, Qwen, Mistral...  │
│  Dynamic context detection via /api/show          │
│  Protocol: httpx                                  │
└──────────────────────────────────────────────────┘
```

### Per-Team Configuration

Each team independently configures:

| Setting | Example (Engineering) | Example (Sales) |
|---------|----------------------|-----------------|
| Provider | Ollama | OpenAI |
| Model | qwen3.5:27b | gpt-4o |
| Base URL | https://localhost/ | (default) |
| API Key | (not needed) | sk-proj-... |
| Temperature | 0.7 | 0.5 |
| Max Tokens | 25,000 | 4,096 |

---

## 11. Admin Dashboard

### What Admins Can Configure

```
┌─────────────────────────────────────────────────────────┐
│  ADMIN DASHBOARD                                         │
│                                                          │
│  ┌──────────────┐                                       │
│  │ Prompt Packs │ • Create/edit/delete packs            │
│  │              │ • Import/export as ZIP                 │
│  │              │ • AI Analyze: auto-suggest layer,     │
│  │              │   tags, priority per module            │
│  │              │ • Inline module editor (markdown)      │
│  │              │ • Manage modes per pack                │
│  ├──────────────┤                                       │
│  │ Teams        │ • Create teams                        │
│  │              │ • Assign prompt pack to team           │
│  │              │ • Configure AI model per team          │
│  │              │   (provider, model, temperature)       │
│  │              │ • Generate invite links                │
│  ├──────────────┤                                       │
│  │ Users        │ • View all users                      │
│  │              │ • Manage team membership               │
│  ├──────────────┤                                       │
│  │ LLM          │ • Add/edit/delete providers           │
│  │ Providers    │ • Set API keys                        │
│  │              │ • Test connection                     │
│  │              │ • Load available models from API      │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### AI Pack Analyzer

The admin can click "AI Analyze Modules" on any pack. The system:

1. Sends all module previews to the configured AI model
2. AI analyzes each module and suggests:
   - **Layer**: Should it be core (always loaded), domain (conditional), or always?
   - **Tags**: What keywords should trigger this module?
   - **Priority**: How important is it (1-100)?
   - **Description**: One-sentence summary
3. Admin reviews suggestions and clicks "Apply All" to update

---

## 12. Docker Deployment

### Service Architecture

```
docker-compose.dev.yml
├── api         (FastAPI backend, port 8000)
│   └── uvicorn with hot-reload
├── worker      (Celery background tasks)
│   └── document processing, embeddings
├── db          (PostgreSQL 16 + pgvector)
│   └── all data: users, teams, packs, conversations, documents, vectors
├── redis       (message broker)
│   └── Celery task queue + prompt cache
└── (future: nginx + frontend container for production)
```

### Starting the Platform

```bash
cd promptbase
cp .env.example .env            # Configure API keys
docker compose -f docker-compose.dev.yml up -d   # Start all services
cd frontend && npm run dev      # Start frontend dev server
# Open http://localhost:5174
```

---

## 13. Data Flow Summary

### Complete Request Journey

```
┌─────────┐      ┌─────────┐      ┌───────────┐      ┌─────────┐
│  USER   │─────→│ FRONTEND│─────→│  BACKEND  │─────→│ AI MODEL│
│         │      │         │      │           │      │         │
│ Types   │      │ Sends   │      │ 1. Auth   │      │ Receives│
│ message │      │ POST    │      │ 2. Load   │      │ system  │
│         │      │ request │      │    config  │      │ prompt  │
│ Uploads │      │ with    │      │ 3. Load   │      │ (60K    │
│ docs    │      │ JWT     │      │    pack   │      │  chars) │
│         │      │ token   │      │ 4. Classify│      │         │
│ Selects │      │         │      │ 5. Compile │      │ +user   │
│ mode    │      │ Reads   │      │ 6. Budget  │      │ message │
│ (or     │      │ SSE     │      │ 7. Stream  │      │         │
│  auto)  │      │ stream  │      │    SSE     │      │ Generates│
│         │◄─────│         │◄─────│           │◄─────│ response│
│ Sees    │      │ Renders │      │ 8. Save   │      │ token   │
│ streamed│      │ markdown│      │    response│      │ by token│
│ response│      │ tokens  │      │ 9. Update │      │         │
│         │      │         │      │    history │      │         │
└─────────┘      └─────────┘      └───────────┘      └─────────┘
```

### What Gets Stored

| Data | Where | Purpose |
|------|-------|---------|
| Users, teams, roles | PostgreSQL `users`, `teams`, `team_members` | Authentication & authorization |
| Prompt packs & modules | PostgreSQL `prompt_packs`, `prompt_modules` | AI instruction set |
| Task modes | PostgreSQL `task_modes` | Behavior presets |
| LLM provider config | PostgreSQL `llm_providers`, `team_llm_config` | AI model settings per team |
| Conversations & messages | PostgreSQL `conversations`, `messages` | Chat history |
| Documents (metadata) | PostgreSQL `documents` | File tracking & status |
| Document text | PostgreSQL `documents.full_text` | Full inject content |
| Document chunks | PostgreSQL `document_chunks` + pgvector | RAG vector search |
| Uploaded files | File storage (local disk / S3) | Original files |
| Background tasks | Redis | Document processing queue |

---

## 14. Key Design Decisions

| Decision | Why |
|----------|-----|
| **Prompt pack in DB, not filesystem** | Admins can edit via UI. No server access needed. Supports multi-team with different packs. |
| **Keyword classification, not LLM classification** | Runs in <1ms. No additional API call. Predictable and debuggable. |
| **SSE streaming, not WebSocket** | Simpler. One-way is all we need. Works through proxies. No connection state to manage. |
| **Celery for document processing** | Non-blocking. Upload returns instantly. Worker processes in background. Retries on failure. |
| **pgvector, not separate vector DB** | One database for everything. Simpler ops. PostgreSQL is already there. |
| **Custom provider abstraction, not LiteLLM** | Full control. No third-party dependency for core functionality. |
| **Dynamic context detection** | Queries Ollama `/api/show` for actual model context size. No hardcoding. Adapts to any model. |
| **Dynamic max_tokens** | Response length calculated from remaining budget. Never wastes context. Never overflows. |
| **Mode auto-detection** | Users don't need to think about modes. System figures it out. Manual override still available. |

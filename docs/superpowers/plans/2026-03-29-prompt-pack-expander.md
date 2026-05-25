# Prompt Pack Expander Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a chat-based interview system in the Admin Packs page where an LLM dynamically asks questions about the organization, then generates prompt pack modules. Supports creating from scratch or expanding existing packs via fork.

**Architecture:** Three backend endpoints (chat, generate, apply) handle the interview loop and module creation. The interview is stateless — frontend sends full conversation history with each request. A modal with chat interface + module review panel handles the UI. Packs are forked (duplicated), never edited in place. Pack deletion is also added.

**Tech Stack:** Python/FastAPI (backend), React 19/TypeScript/Tailwind (frontend), SSE streaming for chat

---

## File Structure

| File | Role |
|------|------|
| `promptbase/backend/app/admin/pack_builder.py` | **Create:** Router with chat, generate, apply endpoints |
| `promptbase/backend/app/admin/routes.py` | **Modify:** Add delete pack endpoint |
| `promptbase/backend/app/main.py` | **Modify:** Register pack_builder router |
| `promptbase/frontend/src/components/PackBuilderModal.tsx` | **Create:** Interview chat + generate + review UI |
| `promptbase/frontend/src/components/ModuleReview.tsx` | **Create:** Module list with accept/reject toggles |
| `promptbase/frontend/src/pages/admin/AdminPacks.tsx` | **Modify:** Add Create via AI, Expand, Delete buttons |

---

### Task 1: Backend — Delete pack endpoint

**Files:**
- Modify: `promptbase/backend/app/admin/routes.py`

- [ ] **Step 1: Add delete pack endpoint**

Add after the `create_pack` endpoint (after line 64):

```python
@router.delete("/packs/{pack_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pack(
    pack_id: uuid.UUID,
    force: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    pack_result = await db.execute(select(PromptPack).where(PromptPack.id == pack_id))
    pack = pack_result.scalar_one_or_none()
    if not pack:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Check if assigned to a team
    team_result = await db.execute(select(Team).where(Team.pack_id == pack_id))
    assigned_team = team_result.scalar_one_or_none()
    if assigned_team and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pack is assigned to team '{assigned_team.name}'. Use force=true to delete anyway.",
        )

    if assigned_team:
        assigned_team.pack_id = None
        await db.flush()

    # Delete modes and modules (cascade should handle, but be explicit)
    await db.execute(select(TaskMode).where(TaskMode.pack_id == pack_id))
    modes = (await db.execute(select(TaskMode).where(TaskMode.pack_id == pack_id))).scalars().all()
    for mode in modes:
        await db.delete(mode)

    modules = (await db.execute(select(PromptModule).where(PromptModule.pack_id == pack_id))).scalars().all()
    for module in modules:
        await db.delete(module)

    await db.delete(pack)
    await db.commit()
```

- [ ] **Step 2: Run tests**

Run: `cd promptbase/backend && python3 -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add promptbase/backend/app/admin/routes.py
git commit -m "feat: add delete pack endpoint with team assignment check"
```

---

### Task 2: Backend — Pack builder router (chat + generate + apply)

**Files:**
- Create: `promptbase/backend/app/admin/pack_builder.py`
- Modify: `promptbase/backend/app/main.py`

- [ ] **Step 1: Create pack_builder.py**

```python
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.compiler.budget import count_tokens_approx
from app.compiler.models import PromptModule, PromptPack
from app.database import get_db
from app.providers.base import LLMConfig
from app.providers.models import LLMProviderConfig
from app.providers.registry import get_provider

router = APIRouter(prefix="/api/admin/pack-builder", tags=["pack-builder"])


class BuilderChatRequest(BaseModel):
    messages: list[dict]  # [{role: "user"|"assistant", content: "..."}]
    source_pack_id: uuid.UUID | None = None


class BuilderGenerateRequest(BaseModel):
    messages: list[dict]
    source_pack_id: uuid.UUID | None = None
    pack_name: str = "Generated Pack"


class BuilderApplyRequest(BaseModel):
    pack_name: str
    source_pack_id: uuid.UUID | None = None
    accepted_indices: list[int]
    modules: list[dict]  # [{title, layer, tags, priority, sort_order, content}]


async def _get_llm(db: AsyncSession) -> tuple:
    """Get first available LLM provider and config."""
    result = await db.execute(
        select(LLMProviderConfig).where(LLMProviderConfig.is_enabled == True)
    )
    prov = result.scalars().first()
    if not prov:
        raise HTTPException(status_code=400, detail="No LLM provider configured")

    provider = get_provider(prov.name)
    if not provider:
        raise HTTPException(status_code=400, detail=f"Provider '{prov.name}' not available")

    # Pick model
    if prov.name == "ollama":
        import httpx
        base_url = (prov.base_url or "http://localhost:11434").rstrip("/")
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
                r = await client.get(f"{base_url}/api/tags")
                models = [m["name"] for m in r.json().get("models", [])]
                model = models[0] if models else "llama3"
        except Exception:
            model = "llama3"
    elif prov.name == "anthropic":
        model = "claude-sonnet-4-20250514"
    elif prov.name == "openai":
        model = "gpt-4o"
    else:
        model = "anthropic/claude-sonnet-4-20250514"

    config = LLMConfig(
        model=model,
        api_key=prov.api_key_encrypted or "",
        base_url=prov.base_url or "",
        temperature=0.7,
        max_tokens=4096,
    )

    return provider, config


async def _load_source_modules(db: AsyncSession, pack_id: uuid.UUID) -> str:
    """Load source pack modules as context string."""
    result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack_id).order_by(PromptModule.sort_order)
    )
    modules = result.scalars().all()
    if not modules:
        return ""

    parts = []
    for m in modules:
        parts.append(f"### Module: {m.title}\n- Layer: {m.layer}\n- Tags: {json.dumps(m.tags or [])}\n- Priority: {m.priority}\n\n{m.content[:500]}{'...' if len(m.content) > 500 else ''}")
    return "\n\n---\n\n".join(parts)


INTERVIEW_SYSTEM_PROMPT = """You are a prompt engineering expert helping an admin build a prompt pack for their AI assistant.

Your job is to ask ONE question at a time to understand:
- What the organization does
- What domains/industries they work in
- What workflows and processes they follow
- What roles use the AI assistant
- What types of tasks the AI should help with
- What standards, frameworks, or methodologies they follow

Ask focused, specific questions. Build on previous answers. Do not ask generic questions — tailor each question based on what you've learned so far.

Do NOT generate modules or output JSON. Only ask questions and acknowledge answers.

Keep responses concise — one question per message."""

INTERVIEW_WITH_SOURCE_PROMPT = """You are a prompt engineering expert reviewing an existing prompt pack and helping the admin improve it.

The current pack contains these modules:

{source_modules}

Your job is to ask ONE question at a time to identify:
- Gaps in coverage (domains, workflows, or scenarios not addressed)
- Modules that could be improved or updated
- New capabilities the organization needs
- Changes in processes or standards since the pack was created

Ask focused, specific questions based on what you see in the existing modules. Do not ask generic questions.

Do NOT generate modules or output JSON. Only ask questions and acknowledge answers.

Keep responses concise — one question per message."""

GENERATE_SYSTEM_PROMPT = """You are a prompt engineering expert. Based on the interview conversation, generate a prompt pack.

Output a JSON object with this exact structure:
```json
{{
  "pack_name": "Descriptive Pack Name",
  "modules": [
    {{
      "title": "Module Title",
      "layer": "core",
      "tags": [],
      "priority": 100,
      "sort_order": 0,
      "content": "Full markdown content for this module..."
    }}
  ]
}}
```

Guidelines for modules:
- **core** layer: Foundational instructions loaded for every request (identity, reasoning framework, output format). Priority 100.
- **always** layer: Context always appended (org structure, capability maps). Priority 90.
- **domain** layer: Topic-specific instructions loaded when keywords match. Priority 50. Tags should contain 5-10 keywords that trigger loading.
- Each module's content should be detailed markdown — these become the AI's operating instructions.
- sort_order: 0 for first module, increment by 1.
- Generate between 5-25 modules depending on complexity.

Output ONLY valid JSON. No explanation before or after."""

GENERATE_WITH_SOURCE_PROMPT = """You are a prompt engineering expert. Based on the interview conversation and the existing pack modules below, generate an improved prompt pack.

Existing modules:
{source_modules}

Output a JSON object with this exact structure:
```json
{{
  "pack_name": "Improved Pack Name",
  "modules": [
    {{
      "title": "Module Title",
      "layer": "core",
      "tags": [],
      "priority": 100,
      "sort_order": 0,
      "content": "Full markdown content for this module..."
    }}
  ]
}}
```

Include ALL modules — both unchanged ones from the source and new/modified ones. Mark which are new by adding a clear indicator in the title or content if they didn't exist before.

Guidelines for modules:
- **core** layer: Foundational instructions loaded for every request. Priority 100.
- **always** layer: Context always appended. Priority 90.
- **domain** layer: Topic-specific instructions. Priority 50. Tags should contain 5-10 trigger keywords.
- Each module's content should be detailed markdown.
- sort_order: 0 for first module, increment by 1.

Output ONLY valid JSON. No explanation before or after."""


@router.post("/chat")
async def builder_chat(
    body: BuilderChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    provider, config = await _get_llm(db)

    # Build system prompt
    if body.source_pack_id:
        source_modules = await _load_source_modules(db, body.source_pack_id)
        system_prompt = INTERVIEW_WITH_SOURCE_PROMPT.format(source_modules=source_modules)
    else:
        system_prompt = INTERVIEW_SYSTEM_PROMPT

    async def event_stream():
        try:
            async for token in provider.stream_chat(system_prompt, body.messages, config):
                escaped = token.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)[:500]}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/generate")
async def builder_generate(
    body: BuilderGenerateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    provider, config = await _get_llm(db)
    config.max_tokens = 16384  # Need more tokens for full pack generation
    config.temperature = 0.5  # Slightly more deterministic for structured output

    if body.source_pack_id:
        source_modules = await _load_source_modules(db, body.source_pack_id)
        system_prompt = GENERATE_WITH_SOURCE_PROMPT.format(source_modules=source_modules)
    else:
        system_prompt = GENERATE_SYSTEM_PROMPT

    # Add generation instruction to the conversation
    messages = body.messages + [
        {"role": "user", "content": f"Based on our conversation, generate the prompt pack now. Name it '{body.pack_name}'."}
    ]

    async def event_stream():
        try:
            async for token in provider.stream_chat(system_prompt, messages, config):
                escaped = token.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)[:500]}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/apply", status_code=status.HTTP_201_CREATED)
async def builder_apply(
    body: BuilderApplyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    # Create new pack
    pack = PromptPack(
        name=body.pack_name,
        version="1.0.0",
        description=f"Generated by Pack Builder{' (expanded)' if body.source_pack_id else ''}",
    )
    db.add(pack)
    await db.flush()

    # Add accepted modules
    for idx in body.accepted_indices:
        if idx < 0 or idx >= len(body.modules):
            continue
        mod_data = body.modules[idx]
        module = PromptModule(
            pack_id=pack.id,
            filename=mod_data.get("title", f"module_{idx}").lower().replace(" ", "_") + ".md",
            title=mod_data.get("title", f"Module {idx}"),
            layer=mod_data.get("layer", "core"),
            tags=mod_data.get("tags", []),
            priority=mod_data.get("priority", 50),
            content=mod_data.get("content", ""),
            token_count=count_tokens_approx(mod_data.get("content", "")),
            sort_order=mod_data.get("sort_order", idx),
        )
        db.add(module)

    await db.commit()
    await db.refresh(pack)

    return {"id": str(pack.id), "name": pack.name, "module_count": len(body.accepted_indices)}
```

- [ ] **Step 2: Register router in main.py**

In `promptbase/backend/app/main.py`, add after the existing imports:

```python
from app.admin.pack_builder import router as pack_builder_router
```

And add after `app.include_router(admin_router)`:

```python
app.include_router(pack_builder_router)
```

- [ ] **Step 3: Run tests**

Run: `cd promptbase/backend && python3 -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add promptbase/backend/app/admin/pack_builder.py promptbase/backend/app/main.py
git commit -m "feat: add pack builder endpoints — chat, generate, apply"
```

---

### Task 3: Frontend — ModuleReview component

**Files:**
- Create: `promptbase/frontend/src/components/ModuleReview.tsx`

- [ ] **Step 1: Create ModuleReview component**

```tsx
import { useState } from 'react'
import { Check, X, ChevronRight } from 'lucide-react'

interface ProposedModule {
  title: string
  layer: string
  tags: string[]
  priority: number
  sort_order: number
  content: string
}

interface Props {
  modules: ProposedModule[]
  packName: string
  onPackNameChange: (name: string) => void
  onApply: (acceptedIndices: number[]) => void
  applying: boolean
}

const LAYER_COLOR: Record<string, string> = {
  core: 'text-blue-400 bg-blue-900/30 dark:bg-blue-900/30',
  always: 'text-purple-400 bg-purple-900/30 dark:bg-purple-900/30',
  domain: 'text-green-400 bg-green-900/30 dark:bg-green-900/30',
}

export default function ModuleReview({ modules, packName, onPackNameChange, onApply, applying }: Props) {
  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(modules.map((_, i) => i)))
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const toggleModule = (idx: number) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Review Generated Modules</h3>
        <input
          type="text"
          value={packName}
          onChange={(e) => onPackNameChange(e.target.value)}
          placeholder="Pack name"
          className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          {accepted.size} of {modules.length} modules selected
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {modules.map((mod, idx) => {
          const isAccepted = accepted.has(idx)
          const isExpanded = expandedIdx === idx
          return (
            <div key={idx} className={`rounded-lg border transition-colors ${
              isAccepted
                ? 'border-green-800/50 bg-green-900/10 dark:bg-green-900/10'
                : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 opacity-60'
            }`}>
              <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleModule(idx) }}
                  className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors ${
                    isAccepted ? 'bg-green-600 text-white' : 'bg-gray-300 dark:bg-gray-700 text-gray-500'
                  }`}
                >
                  {isAccepted ? <Check size={12} /> : <X size={12} />}
                </button>
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${LAYER_COLOR[mod.layer] ?? ''}`}>
                  {mod.layer}
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{mod.title}</span>
                <ChevronRight size={14} className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </div>
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2 mt-2 mb-2">
                    {mod.tags.map((tag) => (
                      <span key={tag} className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                  <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono bg-gray-50 dark:bg-gray-900 rounded p-2">
                    {mod.content}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => onApply(Array.from(accepted))}
          disabled={accepted.size === 0 || applying || !packName.trim()}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
        >
          {applying ? 'Creating Pack...' : `Create Pack with ${accepted.size} Modules`}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ModuleReview.tsx
git commit -m "feat: add ModuleReview component with accept/reject toggles"
```

---

### Task 4: Frontend — PackBuilderModal component

**Files:**
- Create: `promptbase/frontend/src/components/PackBuilderModal.tsx`

- [ ] **Step 1: Create PackBuilderModal component**

```tsx
import { useState, useRef, useEffect } from 'react'
import { X, Sparkles, Send, Loader2 } from 'lucide-react'
import { getAccessToken } from '../api/client'
import { api } from '../api/client'
import ChatMessage from './ChatMessage'
import ModuleReview from './ModuleReview'

interface Props {
  sourcePackId: string | null
  sourcePackName: string | null
  onClose: () => void
  onCreated: () => void
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export default function PackBuilderModal({ sourcePackId, sourcePackName, onClose, onCreated }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [phase, setPhase] = useState<'interview' | 'generating' | 'review'>('interview')
  const [generatedModules, setGeneratedModules] = useState<any[]>([])
  const [packName, setPackName] = useState(sourcePackName ? `${sourcePackName} (expanded)` : 'New Pack')
  const [applying, setApplying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  // Start the interview automatically
  useEffect(() => {
    sendToBuilder(
      '/api/admin/pack-builder/chat',
      [],
      sourcePackId
        ? 'I want to expand my existing prompt pack. What should I consider improving?'
        : 'I want to create a new prompt pack for my organization. Let\'s start.'
    )
  }, [])

  const sendToBuilder = async (url: string, prevMessages: ChatMsg[], userMessage: string) => {
    const allMessages = [...prevMessages, { role: 'user' as const, content: userMessage }]
    setMessages(allMessages)
    setInput('')
    setStreaming(true)
    setStreamBuffer('')

    const token = getAccessToken()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          source_pack_id: sourcePackId,
          pack_name: packName,
        }),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullResponse = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          if (data.startsWith('[ERROR]')) {
            fullResponse += `\n\nError: ${data.slice(8)}`
            break
          }
          const decoded = data.replace(/\\n/g, '\n')
          fullResponse += decoded
          setStreamBuffer(fullResponse)
        }
      }

      setMessages([...allMessages, { role: 'assistant', content: fullResponse }])
      setStreamBuffer('')

      // If generating, try to parse the JSON response
      if (url.includes('/generate')) {
        try {
          let jsonStr = fullResponse
          // Strip think tags
          jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/g, '')
          if (jsonStr.includes('```json')) {
            jsonStr = jsonStr.split('```json')[1].split('```')[0]
          } else if (jsonStr.includes('```')) {
            jsonStr = jsonStr.split('```')[1].split('```')[0]
          }
          const idx = jsonStr.indexOf('{')
          if (idx >= 0) jsonStr = jsonStr.slice(idx)
          const lastIdx = jsonStr.lastIndexOf('}')
          if (lastIdx >= 0) jsonStr = jsonStr.slice(0, lastIdx + 1)

          const parsed = JSON.parse(jsonStr)
          setGeneratedModules(parsed.modules || [])
          if (parsed.pack_name) setPackName(parsed.pack_name)
          setPhase('review')
        } catch {
          // If parsing fails, stay in interview and show error
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: 'Failed to parse the generated pack. Let me try again — click "Generate Pack" once more.',
          }])
          setPhase('interview')
        }
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
      }])
    } finally {
      setStreaming(false)
    }
  }

  const handleSend = () => {
    if (!input.trim() || streaming) return
    sendToBuilder('/api/admin/pack-builder/chat', messages, input.trim())
  }

  const handleGenerate = () => {
    setPhase('generating')
    sendToBuilder('/api/admin/pack-builder/generate', messages, 'Generate the pack now.')
  }

  const handleApply = async (acceptedIndices: number[]) => {
    setApplying(true)
    try {
      await api.post('/admin/pack-builder/apply', {
        pack_name: packName,
        source_pack_id: sourcePackId,
        accepted_indices: acceptedIndices,
        modules: generatedModules,
      })
      onCreated()
      onClose()
    } catch (err: any) {
      console.error('Apply failed:', err)
    } finally {
      setApplying(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl w-[900px] h-[700px] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {sourcePackId ? 'Expand Pack' : 'Create Pack with AI'}
            </h2>
            {phase === 'generating' && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Generating...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase === 'interview' && messages.length > 2 && (
              <button
                onClick={handleGenerate}
                disabled={streaming}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors"
              >
                <Sparkles size={12} />
                Generate Pack
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        {phase === 'review' ? (
          <ModuleReview
            modules={generatedModules}
            packName={packName}
            onPackNameChange={setPackName}
            onApply={handleApply}
            applying={applying}
          />
        ) : (
          <>
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/50">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  message={{
                    id: `builder-${i}`,
                    role: msg.role,
                    content: msg.content,
                    token_count: 0,
                    created_at: new Date().toISOString(),
                  }}
                />
              ))}
              {streaming && streamBuffer && (
                <ChatMessage
                  message={{
                    id: 'builder-streaming',
                    role: 'assistant',
                    content: streamBuffer,
                    token_count: 0,
                    created_at: new Date().toISOString(),
                  }}
                  isStreaming
                />
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {phase === 'interview' && (
              <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={streaming}
                    placeholder="Answer the question..."
                    className="flex-1 resize-none bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-32 overflow-y-auto"
                    style={{ fieldSizing: 'content' } as any}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || streaming}
                    className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
                  >
                    <Send size={16} className="text-white" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/PackBuilderModal.tsx
git commit -m "feat: add PackBuilderModal with interview chat and generation"
```

---

### Task 5: Frontend — Update AdminPacks with Create/Expand/Delete buttons

**Files:**
- Modify: `promptbase/frontend/src/pages/admin/AdminPacks.tsx`

- [ ] **Step 1: Add imports, state, and handlers**

At the top of AdminPacks.tsx, add the import:

```typescript
import PackBuilderModal from '../../components/PackBuilderModal'
import { Trash2 } from 'lucide-react'
```

Inside the `AdminPacks` component, add state:

```typescript
const [builderOpen, setBuilderOpen] = useState(false)
const [builderSourceId, setBuilderSourceId] = useState<string | null>(null)
const [builderSourceName, setBuilderSourceName] = useState<string | null>(null)
```

Add delete handler:

```typescript
const deletePack = async (packId: string, packName: string) => {
  if (!confirm(`Delete "${packName}"? This cannot be undone.`)) return
  try {
    await api.delete(`/admin/packs/${packId}?force=true`)
    qc.invalidateQueries({ queryKey: ['admin', 'packs'] })
  } catch (err: any) {
    alert(err.response?.data?.detail ?? 'Failed to delete pack')
  }
}
```

- [ ] **Step 2: Add "Create with AI" button**

In the button group next to "New Pack", add:

```tsx
<button
  onClick={() => {
    setBuilderSourceId(null)
    setBuilderSourceName(null)
    setBuilderOpen(true)
  }}
  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors"
>
  <Sparkles size={16} />
  Create with AI
</button>
```

- [ ] **Step 3: Add Expand and Delete buttons per pack**

In each pack's button row (next to Modes and Export), add:

```tsx
<button
  onClick={() => {
    setBuilderSourceId(pack.id)
    setBuilderSourceName(pack.name)
    setBuilderOpen(true)
  }}
  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
  title="Expand with AI"
>
  <Sparkles size={14} />
  Expand
</button>
<button
  onClick={() => deletePack(pack.id, pack.name)}
  className="p-1.5 text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
  title="Delete pack"
>
  <Trash2 size={16} />
</button>
```

- [ ] **Step 4: Add modal render**

At the end of the component's return, before the closing `</div>`, add:

```tsx
{builderOpen && (
  <PackBuilderModal
    sourcePackId={builderSourceId}
    sourcePackName={builderSourceName}
    onClose={() => setBuilderOpen(false)}
    onCreated={() => qc.invalidateQueries({ queryKey: ['admin', 'packs'] })}
  />
)}
```

- [ ] **Step 5: Build and verify**

Run: `cd promptbase/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add promptbase/frontend/src/pages/admin/AdminPacks.tsx
git commit -m "feat: add Create with AI, Expand, Delete buttons to AdminPacks"
```

---

### Task 6: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Run backend tests**

Run: `cd promptbase/backend && python3 -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Build frontend**

Run: `cd promptbase/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Rebuild Docker**

Run: `cd promptbase && docker compose -f docker-compose.dev.yml up -d --build api`

- [ ] **Step 4: Manual smoke test**

1. Go to Admin → Packs
2. Click "Create with AI" → verify modal opens with chat
3. Answer 3-4 questions, click "Generate Pack" → verify modules appear in review panel
4. Accept/reject some modules, name the pack, click "Create Pack" → verify pack appears in list
5. Click "Expand" on existing pack → verify LLM asks targeted questions about gaps
6. Click "Delete" on a pack → verify confirmation and deletion
7. Try deleting a pack assigned to a team → verify warning

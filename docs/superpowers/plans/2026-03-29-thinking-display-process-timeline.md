# Thinking Display + Process Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse `<think>` tags from model output and display reasoning in the UI, plus show the compilation pipeline as an inline timeline between user message and AI response.

**Architecture:** Backend `ThinkTagParser` wraps the raw token stream to separate thinking from text, emitting typed SSE events (`thinking:`/`text:` prefixes). Metadata is expanded with full process details. Frontend renders an inline process timeline and a thinking block that streams live then auto-collapses.

**Tech Stack:** Python/FastAPI (backend), React 19/TypeScript/Tailwind (frontend), PostgreSQL (new column), Alembic (migration)

---

## File Structure

| File | Role |
|------|------|
| `promptbase/backend/app/chat/think_parser.py` | **Create:** ThinkTagParser — stateful `<think>` tag parser for streaming tokens |
| `promptbase/backend/tests/test_think_parser.py` | **Create:** Tests for ThinkTagParser |
| `promptbase/backend/app/chat/service.py` | **Modify:** Use ThinkTagParser in `stream_chat_response`, store thinking separately |
| `promptbase/backend/app/chat/routes.py` | **Modify:** Expand metadata, emit typed SSE events |
| `promptbase/backend/app/chat/models.py` | **Modify:** Add `thinking_content` column to Message |
| `promptbase/backend/app/chat/schemas.py` | **Modify:** Add `thinking_content` to MessageResponse |
| `promptbase/backend/alembic/versions/xxxx_add_thinking_content.py` | **Create:** Migration |
| `promptbase/frontend/src/hooks/useSSE.ts` | **Modify:** Parse typed events, add `onThinking` |
| `promptbase/frontend/src/types/index.ts` | **Modify:** Expand Message and add ChatMeta fields |
| `promptbase/frontend/src/components/ProcessTimeline.tsx` | **Create:** Inline process display |
| `promptbase/frontend/src/components/ThinkingBlock.tsx` | **Create:** Collapsible thinking display |
| `promptbase/frontend/src/components/ChatMessage.tsx` | **Modify:** Integrate ThinkingBlock |
| `promptbase/frontend/src/components/ChatMain.tsx` | **Modify:** Wire up thinking buffer, process timeline |

---

### Task 1: ThinkTagParser — Tests

**Files:**
- Create: `promptbase/backend/tests/test_think_parser.py`

- [ ] **Step 1: Write tests for ThinkTagParser**

```python
import pytest
from app.chat.think_parser import ThinkTagParser


def test_no_thinking_tags():
    """Plain text passes through as text events."""
    parser = ThinkTagParser()
    tokens = ["Hello", " world", "!"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    assert events == [("text", "Hello"), ("text", " world"), ("text", "!")]


def test_complete_think_block():
    """A complete <think>...</think> block yields thinking events."""
    parser = ThinkTagParser()
    tokens = ["<think>", "I need to reason", "</think>", "Here is the answer"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    types = [e[0] for e in events]
    content = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert "thinking" in types
    assert "text" in types
    assert content == "I need to reason"
    assert text == "Here is the answer"


def test_think_tag_split_across_chunks():
    """<think> tag split across multiple token chunks."""
    parser = ThinkTagParser()
    tokens = ["<thi", "nk>", "reasoning here", "</thi", "nk>", "response"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    thinking = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert thinking == "reasoning here"
    assert text == "response"


def test_think_tag_char_by_char():
    """Tags arriving one character at a time."""
    parser = ThinkTagParser()
    full = "<think>step by step</think>answer"
    events = []
    for ch in full:
        events.extend(parser.feed(ch))
    events.extend(parser.flush())
    thinking = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert thinking == "step by step"
    assert text == "answer"


def test_angle_bracket_not_a_tag():
    """A '<' that doesn't start <think> gets flushed as text."""
    parser = ThinkTagParser()
    tokens = ["Use <b>bold</b> text"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    text = "".join(e[1] for e in events if e[0] == "text")
    assert "<b>bold</b>" in text


def test_accumulated_content():
    """Parser accumulates thinking and text content for DB storage."""
    parser = ThinkTagParser()
    tokens = ["<think>", "deep thought", "</think>", "final answer"]
    for token in tokens:
        parser.feed(token)
    parser.flush()
    assert parser.thinking_content == "deep thought"
    assert parser.text_content == "final answer"


def test_no_thinking_accumulated_content():
    """When there are no think tags, text_content has everything."""
    parser = ThinkTagParser()
    tokens = ["just", " plain", " text"]
    for token in tokens:
        parser.feed(token)
    parser.flush()
    assert parser.thinking_content == ""
    assert parser.text_content == "just plain text"


def test_think_at_start_with_newlines():
    """Think block at start with newlines inside and after."""
    parser = ThinkTagParser()
    tokens = ["<think>\n", "line1\nline2\n", "</think>\n", "response"]
    events = []
    for token in tokens:
        events.extend(parser.feed(token))
    events.extend(parser.flush())
    thinking = "".join(e[1] for e in events if e[0] == "thinking")
    text = "".join(e[1] for e in events if e[0] == "text")
    assert "line1\nline2" in thinking
    assert "response" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd promptbase/backend && python -m pytest tests/test_think_parser.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.chat.think_parser'`

---

### Task 2: ThinkTagParser — Implementation

**Files:**
- Create: `promptbase/backend/app/chat/think_parser.py`

- [ ] **Step 1: Implement ThinkTagParser**

```python
class ThinkTagParser:
    """Stateful parser that separates <think>...</think> blocks from text in a token stream.

    Call feed(token) for each streaming token. It returns a list of (type, content) tuples
    where type is "thinking" or "text". Call flush() at the end to emit any buffered content.

    After processing, thinking_content and text_content hold the accumulated strings for DB storage.
    """

    OPEN_TAG = "<think>"
    CLOSE_TAG = "</think>"

    def __init__(self):
        self._in_thinking = False
        self._tag_buffer = ""
        self.thinking_content = ""
        self.text_content = ""

    def feed(self, token: str) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        for ch in token:
            events.extend(self._feed_char(ch))
        return events

    def _feed_char(self, ch: str) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        self._tag_buffer += ch

        if self._in_thinking:
            # Check if buffer could be the start of </think>
            if self._tag_buffer == self.CLOSE_TAG:
                # Complete close tag found
                self._in_thinking = False
                self._tag_buffer = ""
                return events
            if self.CLOSE_TAG.startswith(self._tag_buffer):
                # Partial match for close tag, keep buffering
                return events
            # Not a close tag — flush buffer as thinking content
            content = self._tag_buffer
            self._tag_buffer = ""
            self.thinking_content += content
            events.append(("thinking", content))
            return events
        else:
            # Not in thinking mode
            if self._tag_buffer == self.OPEN_TAG:
                # Complete open tag found
                self._in_thinking = True
                self._tag_buffer = ""
                return events
            if self.OPEN_TAG.startswith(self._tag_buffer):
                # Partial match for open tag, keep buffering
                return events
            # Not an open tag — flush buffer as text content
            content = self._tag_buffer
            self._tag_buffer = ""
            self.text_content += content
            events.append(("text", content))
            return events

    def flush(self) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        if self._tag_buffer:
            event_type = "thinking" if self._in_thinking else "text"
            if event_type == "thinking":
                self.thinking_content += self._tag_buffer
            else:
                self.text_content += self._tag_buffer
            events.append((event_type, self._tag_buffer))
            self._tag_buffer = ""
        return events
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd promptbase/backend && python -m pytest tests/test_think_parser.py -v`
Expected: All 8 tests PASS

- [ ] **Step 3: Commit**

```bash
git add promptbase/backend/app/chat/think_parser.py promptbase/backend/tests/test_think_parser.py
git commit -m "feat: add ThinkTagParser for streaming <think> tag detection"
```

---

### Task 3: Database — Add thinking_content column

**Files:**
- Modify: `promptbase/backend/app/chat/models.py:25-35`
- Modify: `promptbase/backend/app/chat/schemas.py:15-22`

- [ ] **Step 1: Add thinking_content to Message model**

In `promptbase/backend/app/chat/models.py`, add a new column after `content`:

```python
# In the Message class, after line 31 (content column):
thinking_content: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 2: Add thinking_content to MessageResponse schema**

In `promptbase/backend/app/chat/schemas.py`, add to `MessageResponse`:

```python
class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    thinking_content: str | None = None
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: Generate Alembic migration**

Run: `cd promptbase/backend && alembic revision --autogenerate -m "add thinking_content to messages"`
Expected: New migration file created in `alembic/versions/`

- [ ] **Step 4: Verify migration content**

Read the generated migration file and confirm it contains:
```python
op.add_column('messages', sa.Column('thinking_content', sa.Text(), nullable=True))
```
in upgrade, and the reverse in downgrade.

- [ ] **Step 5: Commit**

```bash
git add promptbase/backend/app/chat/models.py promptbase/backend/app/chat/schemas.py promptbase/backend/alembic/versions/
git commit -m "feat: add thinking_content column to messages table"
```

---

### Task 4: Backend — Expand metadata and typed SSE events

**Files:**
- Modify: `promptbase/backend/app/chat/routes.py:77-126`
- Modify: `promptbase/backend/app/chat/service.py:162-191`

- [ ] **Step 1: Update compiler to track modules by layer**

In `promptbase/backend/app/compiler/compiler.py`, add `modules_by_layer` to the return dict. Replace lines 79-88:

```python
        return {
            "system_prompt": system_prompt,
            "total_tokens": result["total_tokens"] + count_tokens_approx(SAFETY_WRAPPER),
            "modules_loaded": modules_loaded,
            "modules_by_layer": {
                "core": [m["name"] for m in self.modules if m["layer"] == "core"],
                "always": [m["name"] for m in self.modules if m["layer"] == "always"],
                "domain": [m["name"] for m in self.modules if m["layer"] == "domain"
                           and m["name"] in modules_loaded],
            },
            "domains_matched": list(matched_domains),
            "mode": detected_mode,
            "trimmed": result["trimmed"],
            "budget_remaining": result["remaining"],
            "core_mode": budget.core_mode,
        }
```

- [ ] **Step 2: Update stream_chat_response to use ThinkTagParser**

Replace `stream_chat_response` in `promptbase/backend/app/chat/service.py` (lines 162-191):

```python
async def stream_chat_response(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    prepared: dict,
) -> AsyncIterator[tuple[str, str]]:
    """Stream the LLM response, parsing <think> tags into typed events."""
    from app.chat.think_parser import ThinkTagParser

    provider = prepared["provider"]
    compiled = prepared["compiled"]
    history = prepared["history"]
    llm_config = prepared["llm_config"]

    if not provider:
        yield ("text", "Error: Provider not found")
        return

    messages = history + [{"role": "user", "content": user_message}]
    parser = ThinkTagParser()

    async for token in provider.stream_chat(compiled["system_prompt"], messages, llm_config):
        for event in parser.feed(token):
            yield event

    for event in parser.flush():
        yield event

    # Save message with separated content
    content = parser.text_content
    thinking = parser.thinking_content or None

    assistant_msg = Message(
        conversation_id=conversation.id, role="assistant",
        content=content, thinking_content=thinking,
        token_count=count_tokens_approx(content),
    )
    db.add(assistant_msg)
    await db.commit()
```

- [ ] **Step 3: Update chat_stream route with expanded metadata and typed events**

Replace the `event_stream` function inside `chat_stream` in `promptbase/backend/app/chat/routes.py` (lines 102-124):

```python
    async def event_stream():
        # First event: expanded metadata
        meta = {
            "conversation_id": str(conversation.id),
            "provider": provider_name,
            "model": llm_config.model,
            "mode_detected": compiled.get("mode"),
            "modules_loaded": compiled.get("modules_loaded", []),
            "modules_by_layer": compiled.get("modules_by_layer", {}),
            "core_mode": compiled.get("core_mode"),
            "domains_matched": compiled.get("domains_matched", []),
            "prompt_tokens": compiled.get("total_tokens", 0),
            "context_limit": prepared.get("context_limit", 0),
            "budget_remaining": compiled.get("budget_remaining", 0),
            "trimmed": compiled.get("trimmed", []),
        }
        yield f"data: {_json.dumps(meta)}\n\n"

        try:
            async for event_type, content in stream_chat_response(
                db, conversation, body.message, prepared,
            ):
                escaped = content.replace("\n", "\\n")
                yield f"data: {event_type}:{escaped}\n\n"
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: [ERROR] {str(e)[:500]}\n\n"
        yield "data: [DONE]\n\n"
```

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `cd promptbase/backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add promptbase/backend/app/chat/service.py promptbase/backend/app/chat/routes.py promptbase/backend/app/compiler/compiler.py
git commit -m "feat: emit typed SSE events (thinking/text) with expanded metadata"
```

---

### Task 5: Frontend — Update types and useSSE hook

**Files:**
- Modify: `promptbase/frontend/src/types/index.ts:33-39`
- Modify: `promptbase/frontend/src/hooks/useSSE.ts`

- [ ] **Step 1: Update Message type**

In `promptbase/frontend/src/types/index.ts`, update the `Message` interface:

```typescript
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking_content?: string | null
  token_count: number
  created_at: string
}
```

- [ ] **Step 2: Update ChatMeta and SSEOptions in useSSE.ts**

Replace the full contents of `promptbase/frontend/src/hooks/useSSE.ts`:

```typescript
import { useRef, useCallback } from 'react'
import { getAccessToken } from '../api/client'

export interface ChatMeta {
  conversation_id: string
  provider: string
  model: string
  mode_detected: string | null
  modules_loaded: string[]
  modules_by_layer: Record<string, string[]>
  core_mode: string | null
  domains_matched: string[]
  prompt_tokens: number
  context_limit: number
  budget_remaining: number
  trimmed: string[]
}

interface SSEOptions {
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onMeta: (meta: ChatMeta) => void
  onDone: () => void
  onError: (err: string) => void
}

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null)

  const startStream = useCallback(
    async (
      body: {
        message: string
        team_id: string
        conversation_id?: string | null
        document_ids?: string[]
        mode?: string | null
      },
      opts: SSEOptions
    ) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const token = getAccessToken()
      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!res.ok) {
          opts.onError(`Request failed: ${res.status}`)
          return
        }

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let metaReceived = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') { opts.onDone(); return }
            if (data.startsWith('[ERROR]')) { opts.onError(data.slice(8)); opts.onDone(); return }

            // First event is metadata JSON
            if (!metaReceived) {
              try {
                const parsed = JSON.parse(data)
                if (parsed.conversation_id) {
                  metaReceived = true
                  opts.onMeta(parsed as ChatMeta)
                  continue
                }
              } catch {}
            }

            // Typed events: "thinking:content" or "text:content"
            if (data.startsWith('thinking:')) {
              opts.onThinking(data.slice(9).replace(/\\n/g, '\n'))
            } else if (data.startsWith('text:')) {
              opts.onToken(data.slice(5).replace(/\\n/g, '\n'))
            } else {
              // Backwards compatibility: unprefixed = text
              opts.onToken(data.replace(/\\n/g, '\n'))
            }
          }
        }
        opts.onDone()
      } catch (err: any) {
        if (err.name !== 'AbortError') opts.onError(err.message)
      }
    },
    []
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { startStream, cancel }
}
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/frontend/src/types/index.ts promptbase/frontend/src/hooks/useSSE.ts
git commit -m "feat: frontend SSE hook handles thinking/text typed events"
```

---

### Task 6: Frontend — ProcessTimeline component

**Files:**
- Create: `promptbase/frontend/src/components/ProcessTimeline.tsx`

- [ ] **Step 1: Create ProcessTimeline component**

```tsx
import type { ChatMeta } from '../hooks/useSSE'

interface Props {
  meta: ChatMeta
}

export default function ProcessTimeline({ meta }: Props) {
  const coreMods = meta.modules_by_layer?.core?.length ?? 0
  const alwaysMods = meta.modules_by_layer?.always?.length ?? 0
  const domainMods = meta.modules_by_layer?.domain?.length ?? 0

  const moduleSummary = [
    coreMods > 0 && `${coreMods} core`,
    alwaysMods > 0 && `${alwaysMods} always`,
    domainMods > 0 && `${domainMods} domain`,
  ].filter(Boolean).join(' + ')

  const segments: string[] = []

  if (meta.mode_detected) {
    segments.push(`${meta.mode_detected} mode`)
  }

  if (meta.domains_matched.length > 0) {
    segments.push(meta.domains_matched.join(', '))
  }

  if (moduleSummary) {
    segments.push(moduleSummary)
  }

  if (meta.core_mode === 'condensed') {
    segments.push('condensed core')
  }

  segments.push(
    `${meta.prompt_tokens.toLocaleString()} / ${meta.context_limit.toLocaleString()} tokens`
  )

  segments.push(`${meta.model} (${meta.provider})`)

  if (meta.trimmed.length > 0) {
    segments.push(`trimmed: ${meta.trimmed.join(', ')}`)
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-600 border-l-2 border-gray-800 ml-4 my-1 flex-wrap">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-700">&middot;</span>}
          <span className={
            seg.includes('mode') ? 'text-indigo-500' :
            seg.includes('trimmed') ? 'text-amber-500' :
            seg.includes('condensed') ? 'text-amber-500' :
            ''
          }>{seg}</span>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ProcessTimeline.tsx
git commit -m "feat: add ProcessTimeline component for inline pipeline display"
```

---

### Task 7: Frontend — ThinkingBlock component

**Files:**
- Create: `promptbase/frontend/src/components/ThinkingBlock.tsx`

- [ ] **Step 1: Create ThinkingBlock component**

```tsx
import { useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  isStreaming: boolean
  hasTextStarted: boolean
}

export default function ThinkingBlock({ content, isStreaming, hasTextStarted }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Auto-collapse when text starts arriving
  useEffect(() => {
    if (hasTextStarted && isStreaming) {
      setCollapsed(true)
    }
  }, [hasTextStarted, isStreaming])

  // For history (not streaming), start collapsed
  useEffect(() => {
    if (!isStreaming && content) {
      setCollapsed(true)
    }
  }, [])

  if (!content) return null

  return (
    <div className="mb-3">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors py-1"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
        />
        <span>Thinking{isStreaming && !hasTextStarted ? '...' : ''}</span>
        {collapsed && (
          <span className="text-gray-600 ml-1 truncate max-w-xs">
            {content.slice(0, 60)}{content.length > 60 ? '...' : ''}
          </span>
        )}
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          collapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
        }`}
      >
        <div
          ref={contentRef}
          className="pl-4 border-l border-gray-700 mt-1 text-sm text-gray-500 italic prose prose-invert prose-sm max-w-none overflow-y-auto max-h-[500px]"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          {isStreaming && !hasTextStarted && (
            <span className="inline-block w-1.5 h-3 bg-gray-500 animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ThinkingBlock.tsx
git commit -m "feat: add ThinkingBlock component with streaming and auto-collapse"
```

---

### Task 8: Frontend — Integrate into ChatMessage

**Files:**
- Modify: `promptbase/frontend/src/components/ChatMessage.tsx`

- [ ] **Step 1: Update ChatMessage to render ThinkingBlock**

Replace the full contents of `promptbase/frontend/src/components/ChatMessage.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Bot } from 'lucide-react'
import type { Message } from '../types'
import ExportButton from './ExportButton'
import ThinkingBlock from './ThinkingBlock'

interface Props {
  message: Message
  isStreaming?: boolean
  thinkingContent?: string
  hasTextStarted?: boolean
}

export default function ChatMessage({ message, isStreaming = false, thinkingContent, hasTextStarted = true }: Props) {
  const isUser = message.role === 'user'
  const thinking = thinkingContent || message.thinking_content || ''

  return (
    <div className={`flex gap-3 px-4 py-4 ${isUser ? '' : 'bg-gray-900/40'}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-indigo-600' : 'bg-gray-700'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        {!isUser && thinking && (
          <ThinkingBlock
            content={thinking}
            isStreaming={isStreaming}
            hasTextStarted={hasTextStarted}
          />
        )}
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="border-collapse border border-gray-700 text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-700 bg-gray-800 px-3 py-1.5 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-700 px-3 py-1.5">{children}</td>
              ),
              code: ({ inline, children }: any) =>
                inline ? (
                  <code className="bg-gray-800 text-indigo-300 px-1 rounded text-xs">{children}</code>
                ) : (
                  <pre className="bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs">
                    <code>{children}</code>
                  </pre>
                ),
            }}
          >
            {message.content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5" />
          )}
        </div>
        {!isUser && !isStreaming && message.id && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-gray-600">{message.token_count} tokens</span>
            <ExportButton messageId={message.id} />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ChatMessage.tsx
git commit -m "feat: integrate ThinkingBlock into ChatMessage"
```

---

### Task 9: Frontend — Wire up ChatMain

**Files:**
- Modify: `promptbase/frontend/src/components/ChatMain.tsx`

- [ ] **Step 1: Update ChatMain with thinking buffer and ProcessTimeline**

Replace the full contents of `promptbase/frontend/src/components/ChatMain.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useSSE, type ChatMeta } from '../hooks/useSSE'
import type { Team, Conversation, Message, TaskMode } from '../types'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import ExportButton from './ExportButton'
import ProcessTimeline from './ProcessTimeline'

interface Props {
  team: Team
  conversation: Conversation | null
  onConversationCreated: (conv: Conversation) => void
  activeMode: TaskMode | null
  selectedDocIds: string[]
}

export default function ChatMain({ team, conversation, onConversationCreated, activeMode, selectedDocIds }: Props) {
  const queryClient = useQueryClient()
  const { startStream, cancel } = useSSE()
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [thinkingBuffer, setThinkingBuffer] = useState('')
  const [hasTextStarted, setHasTextStarted] = useState(false)
  const hasTextStartedRef = useRef(false)
  const [conversationId, setConversationId] = useState<string | null>(conversation?.id ?? null)
  const [lastMeta, setLastMeta] = useState<ChatMeta | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setConversationId(conversation?.id ?? null)
  }, [conversation])

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['messages', team.id, conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await api.get(`/chat/conversations/${team.id}/${conversationId}/messages`)
      return res.data
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer, thinkingBuffer])

  const handleSend = async (text: string, formData?: Record<string, string>) => {
    let message = text
    if (formData && Object.keys(formData).length > 0) {
      const fields = Object.entries(formData)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n')
      message = text ? `${text}\n\n${fields}` : fields
    }

    setIsStreaming(true)
    setStreamBuffer('')
    setThinkingBuffer('')
    setHasTextStarted(false)
    hasTextStartedRef.current = false
    setLastMeta(null)

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: message,
      token_count: 0,
      created_at: new Date().toISOString(),
    }
    queryClient.setQueryData<Message[]>(
      ['messages', team.id, conversationId],
      (old) => [...(old ?? []), tempUserMsg]
    )

    await startStream(
      {
        message,
        team_id: team.id,
        conversation_id: conversationId,
        document_ids: selectedDocIds,
        mode: activeMode?.name ?? null,
      },
      {
        onMeta: (meta) => {
          setLastMeta(meta)
          setConversationId(meta.conversation_id)
          queryClient.invalidateQueries({ queryKey: ['conversations', team.id] })
          if (!conversationId) {
            onConversationCreated({
              id: meta.conversation_id, title: message.slice(0, 60), mode: meta.mode_detected,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              message_count: 1,
            })
          }
        },
        onThinking: (token) => {
          setThinkingBuffer((prev) => prev + token)
        },
        onToken: (token) => {
          if (!hasTextStartedRef.current) {
            hasTextStartedRef.current = true
            setHasTextStarted(true)
          }
          setStreamBuffer((prev) => prev + token)
        },
        onDone: () => {
          setIsStreaming(false)
          setStreamBuffer('')
          setThinkingBuffer('')
          setHasTextStarted(false)
          hasTextStartedRef.current = false
          if (conversationId) {
            queryClient.invalidateQueries({ queryKey: ['messages', team.id, conversationId] })
          }
        },
        onError: (err) => {
          setIsStreaming(false)
          setStreamBuffer('')
          setThinkingBuffer('')
          setHasTextStarted(false)
          hasTextStartedRef.current = false
          queryClient.setQueryData<Message[]>(
            ['messages', team.id, conversationId],
            (old) => [...(old ?? []), {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `**Error:** ${err}`,
              token_count: 0,
              created_at: new Date().toISOString(),
            }]
          )
        },
      }
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-white">
            {conversation?.title ?? 'New Conversation'}
          </h1>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
            <span>{team.name}</span>
            {lastMeta?.mode_detected && (
              <>
                <span className="text-gray-700">&middot;</span>
                <span className="text-indigo-400">{lastMeta.mode_detected} mode</span>
              </>
            )}
            {activeMode && !lastMeta?.mode_detected && (
              <>
                <span className="text-gray-700">&middot;</span>
                <span className="text-indigo-400">{activeMode.name} mode</span>
              </>
            )}
          </div>
        </div>
        {conversationId && (
          <ExportButton conversationId={conversationId} label="Export" />
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <p className="text-lg font-medium text-gray-400">Start a conversation</p>
            <p className="text-sm">Type a message below. Mode auto-detects from your message.</p>
            <p className="text-xs text-gray-600">analysis · solution design · implementation · tender response · architecture review · business process</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={msg.id}>
            <ChatMessage message={msg} />
            {/* Show process timeline between assistant messages with meta */}
            {msg.role === 'user' && idx === messages.length - 1 && lastMeta && !isStreaming && (
              <ProcessTimeline meta={lastMeta} />
            )}
          </div>
        ))}
        {isStreaming && lastMeta && (
          <ProcessTimeline meta={lastMeta} />
        )}
        {isStreaming && (streamBuffer || thinkingBuffer) && (
          <ChatMessage
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamBuffer,
              token_count: 0,
              created_at: new Date().toISOString(),
            }}
            isStreaming
            thinkingContent={thinkingBuffer}
            hasTextStarted={hasTextStarted}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={cancel}
        isStreaming={isStreaming}
        activeMode={activeMode}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ChatMain.tsx
git commit -m "feat: wire up thinking buffer and process timeline in ChatMain"
```

---

### Task 10: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Run backend tests**

Run: `cd promptbase/backend && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Run Alembic migration**

Run: `cd promptbase/backend && alembic upgrade head`
Expected: Migration applies cleanly, `thinking_content` column added to messages table

- [ ] **Step 3: Build frontend**

Run: `cd promptbase/frontend && npm run build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 4: Manual smoke test**

Start the app and send a message to a model that outputs `<think>` tags (e.g., Qwen3 via Ollama):
1. Verify the process timeline appears between user message and response
2. Verify thinking streams in real-time in dimmed italic
3. Verify thinking auto-collapses when response text begins
4. Verify clicking the "Thinking..." bar expands the reasoning
5. Verify reloading the conversation shows thinking as a collapsed bar from DB

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: thinking display and process timeline - complete"
```

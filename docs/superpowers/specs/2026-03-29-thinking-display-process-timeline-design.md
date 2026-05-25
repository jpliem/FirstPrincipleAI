# Thinking Display + Process Timeline

**Date:** 2026-03-29
**Status:** Approved

## Overview

Two features for PromptBase's chat interface:

1. **Thinking display** — Parse `<think>...</think>` tags from model output (Qwen3, DeepSeek R1, etc.), show reasoning in the UI with animated reveal during streaming, auto-collapse when response text begins.
2. **Process timeline** — Show the compilation pipeline inline between user message and AI response: classification, routing, module loading, token budgeting.

## Design Decisions

- **Approach B (backend parsing):** The backend parses `<think>` tags from the raw token stream, emits typed SSE events, and persists thinking content in the database separately from response text.
- **Inline timeline:** Process info rendered as a compact bar between user message and AI response.
- **Animated reveal for thinking:** Thinking streams in real-time (dimmed/italic), auto-collapses when text tokens start. Expandable in history.
- **Provider-agnostic:** No provider API changes. Parsing happens at the service layer on the raw text stream from any provider.

## Architecture

### SSE Event Protocol (Updated)

Current protocol:
```
data: {metadata JSON}     ← first event
data: token text           ← subsequent events
data: [DONE]               ← terminal
```

New protocol:
```
data: {metadata JSON}      ← first event (expanded fields)
data: thinking:reasoning   ← thinking tokens (new)
data: text:response        ← text tokens (new prefix)
data: [DONE]               ← terminal
```

Unprefixed token events are treated as `text:` for backwards compatibility.

### Backend: ThinkTagParser

A stateful parser in `chat/service.py` that wraps the raw token stream from any provider. It buffers characters to detect `<think>` and `</think>` tags across chunk boundaries.

**States:**
- `TEXT` — normal text output, emit as `text:` events
- `TAG_OPEN` — buffering characters that might be `<think>`
- `THINKING` — inside thinking block, emit as `thinking:` events
- `TAG_CLOSE` — buffering characters that might be `</think>`

**Behavior:**
- Buffers partial tag matches (e.g., `<thi` arriving in one chunk, `nk>` in the next)
- If buffer doesn't match a tag, flushes buffered characters as the current event type
- After stream completes, returns both `thinking_content` and `text_content` for DB storage

### Backend: Expanded Metadata

The first SSE metadata event includes full process details:

```json
{
  "conversation_id": "uuid",
  "provider": "ollama",
  "model": "qwen3:latest",
  "mode_detected": "analysis",
  "modules_loaded": ["00_START_HERE", "01_PROJECT_OVERVIEW", "capability_map", "embedded_iot"],
  "modules_by_layer": {
    "core": ["00_START_HERE", "01_PROJECT_OVERVIEW"],
    "always": ["capability_map"],
    "domain": ["embedded_iot"]
  },
  "core_mode": "full",
  "domains_matched": ["embedded_iot"],
  "prompt_tokens": 1847,
  "context_limit": 32768,
  "budget_remaining": 18000,
  "trimmed": []
}
```

### Database: Message.thinking_content

New nullable `Text` column on the `messages` table. Only populated for assistant messages that contain `<think>` blocks. Exposed via `MessageResponse` schema so historical conversations display thinking.

### Frontend: useSSE Changes

- New callback: `onThinking(token: string)` in `SSEOptions`
- Parse logic: lines starting with `thinking:` call `onThinking`, lines starting with `text:` call `onToken`, unprefixed lines call `onToken`
- `ChatMeta` interface expanded: `modules_loaded` changes from `number` to `string[]`, adds `provider`, `model`, `modules_by_layer`, `core_mode`, `budget_remaining`, `trimmed`

### Frontend: ProcessTimeline Component

New component rendered inline between user message and AI response. Compact horizontal flow:

```
analysis mode  ·  embedded_iot  ·  2 core + 1 always + 1 domain  ·  1,847 / 32,768 tokens  ·  qwen3 (ollama)
```

Styled with muted text (`text-gray-600`), small font (`text-xs`), subtle left border or dot separators. Always visible, not collapsible.

### Frontend: ChatMessage Thinking Display

**During streaming:**
- Thinking text renders above the response text in dimmed italic (`text-gray-500 italic`)
- Streams in real-time as `thinking:` tokens arrive
- When the first `text:` token arrives, the thinking section animates into a collapsed bar: "Thinking... (click to expand)"

**In history (loaded from DB):**
- If `message.thinking_content` exists, show a collapsed "Thinking..." bar
- Click to expand and see the full reasoning text
- Rendered with same dimmed italic style

**Collapsed bar styling:**
- Small pill/badge: light background, muted text
- Chevron icon indicating expandable
- Shows first ~50 chars of thinking as preview on hover (optional)

## Files Changed

| File | Change |
|------|--------|
| `backend/app/chat/service.py` | Add `ThinkTagParser` class, modify `stream_chat_response` to yield `("thinking", text)` / `("text", text)` tuples |
| `backend/app/chat/routes.py` | Expand metadata with process details, emit `thinking:`/`text:` prefixed SSE events |
| `backend/app/chat/models.py` | Add `thinking_content: Text` nullable column to `Message` |
| `backend/app/chat/schemas.py` | Add `thinking_content: str | None` to `MessageResponse` |
| `backend/alembic/versions/xxxx_add_thinking_content.py` | Migration for new column |
| `frontend/src/hooks/useSSE.ts` | Parse typed events, add `onThinking` callback, expand `ChatMeta` |
| `frontend/src/types/index.ts` | Add `thinking_content` to `Message` interface |
| `frontend/src/components/ChatMain.tsx` | Add `thinkingBuffer` state, render `ProcessTimeline`, pass thinking to `ChatMessage` |
| `frontend/src/components/ChatMessage.tsx` | Render thinking block (streaming animated + collapsed history) |
| `frontend/src/components/ProcessTimeline.tsx` | New component: inline process display |

## Out of Scope

- Provider-specific thinking APIs (Anthropic extended thinking, OpenAI reasoning tokens) — future enhancement
- Configurable thinking budget or toggle — all `<think>` tags are parsed automatically
- Thinking in export (DOCX/PDF) — future enhancement

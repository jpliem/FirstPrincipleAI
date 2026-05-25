# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation search/rename/pin/auto-name, copy message, mode chips, error banner with retry, typing indicator, admin password reset, and personal document support.

**Architecture:** Backend-first approach — migration and new endpoints first, then frontend components. Each task is self-contained and produces a commit. Features are independent so ordering is flexible, but the migration must come first since multiple features depend on it.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript/Tailwind (frontend), Alembic (migrations)

---

## File Map

### Backend — Create
| File | Purpose |
|------|---------|
| `promptbase/backend/alembic/versions/f6a7b8c9d0e1_pin_and_nullable_doc_team.py` | Migration: add `is_pinned` to conversations, make `documents.team_id` nullable |

### Backend — Modify
| File | Purpose |
|------|---------|
| `promptbase/backend/app/chat/models.py` | Add `is_pinned` field to Conversation |
| `promptbase/backend/app/chat/schemas.py` | Add `ConversationUpdate` schema, `is_pinned` to response |
| `promptbase/backend/app/chat/routes.py` | Add PATCH endpoint, search param, pinned-first sort, auto-name in stream |
| `promptbase/backend/app/chat/service.py` | Add `generate_title` helper, call it after first exchange |
| `promptbase/backend/app/documents/models.py` | Make `team_id` nullable |
| `promptbase/backend/app/documents/routes.py` | Add personal document endpoints |
| `promptbase/backend/app/documents/schemas.py` | Make `team_id` optional in response |
| `promptbase/backend/app/admin/routes.py` | Add password reset endpoint |

### Frontend — Create
| File | Purpose |
|------|---------|
| `promptbase/frontend/src/components/ModeChips.tsx` | Mode pill selector with tooltips |
| `promptbase/frontend/src/components/TypingIndicator.tsx` | Pulsing dots animation |
| `promptbase/frontend/src/components/ErrorBanner.tsx` | Dismissible error with retry |
| `promptbase/frontend/src/components/ContextMenu.tsx` | Right-click menu for conversations |
| `promptbase/frontend/src/components/ResetPasswordModal.tsx` | Admin password reset modal |

### Frontend — Modify
| File | Purpose |
|------|---------|
| `promptbase/frontend/src/types/index.ts` | Add `is_pinned` to Conversation |
| `promptbase/frontend/src/hooks/useSSE.ts` | Parse `new_title` from `[DONE]` event |
| `promptbase/frontend/src/components/ConversationList.tsx` | Search, pinned section, inline rename, context menu |
| `promptbase/frontend/src/components/ChatMessage.tsx` | Copy button on hover |
| `promptbase/frontend/src/components/ChatMain.tsx` | Error banner, typing indicator, auto-name, last-send ref |
| `promptbase/frontend/src/components/ChatInput.tsx` | Mode chips, personal doc support |
| `promptbase/frontend/src/components/ChatSidebar.tsx` | Remove ModeSelector, pass search state |
| `promptbase/frontend/src/components/AttachButton.tsx` | Support null teamId for personal docs |
| `promptbase/frontend/src/hooks/useDocumentStatus.ts` | Add personal document hooks |
| `promptbase/frontend/src/pages/admin/AdminUsers.tsx` | Reset password button and modal |
| `promptbase/frontend/src/index.css` | Typing indicator keyframes |

---

## Task 1: Database Migration

**Files:**
- Create: `promptbase/backend/alembic/versions/f6a7b8c9d0e1_pin_and_nullable_doc_team.py`

- [ ] **Step 1: Create migration file**

```python
"""add is_pinned to conversations and make documents.team_id nullable

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-01
"""
from alembic import op
import sqlalchemy as sa

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_conversations_pinned_updated", "conversations", [sa.text("is_pinned DESC"), sa.text("updated_at DESC")])
    op.alter_column("documents", "team_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column("documents", "team_id", existing_type=sa.UUID(), nullable=False)
    op.drop_index("ix_conversations_pinned_updated", table_name="conversations")
    op.drop_column("conversations", "is_pinned")
```

- [ ] **Step 2: Run migration**

Run: `cd promptbase/backend && alembic upgrade head`
Expected: migration applies successfully

- [ ] **Step 3: Commit**

```bash
git add promptbase/backend/alembic/versions/f6a7b8c9d0e1_pin_and_nullable_doc_team.py
git commit -m "feat: migration for is_pinned and nullable doc team_id"
```

---

## Task 2: Backend — Conversation Model & Schema Updates

**Files:**
- Modify: `promptbase/backend/app/chat/models.py`
- Modify: `promptbase/backend/app/chat/schemas.py`

- [ ] **Step 1: Add is_pinned to Conversation model**

In `promptbase/backend/app/chat/models.py`, add after line 18 (`mode` field):

```python
    is_pinned: Mapped[bool] = mapped_column(default=False)
```

Also add `Boolean` to the sqlalchemy import on line 4:

```python
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
```

- [ ] **Step 2: Update schemas**

In `promptbase/backend/app/chat/schemas.py`, add `ConversationUpdate` schema and update `ConversationResponse`:

Replace the entire file content with:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    conversation_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] = []
    mode: str | None = None
    basic_mode: bool = False


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    thinking_content: str | None = None
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationUpdate(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    mode: str | None
    is_pinned: bool = False
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    conversations: list[ConversationResponse]
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/backend/app/chat/models.py promptbase/backend/app/chat/schemas.py
git commit -m "feat: add is_pinned to conversation model and ConversationUpdate schema"
```

---

## Task 3: Backend — Conversation PATCH, Search, Pinned Sort

**Files:**
- Modify: `promptbase/backend/app/chat/routes.py`

- [ ] **Step 1: Add PATCH endpoint and update list endpoints**

In `promptbase/backend/app/chat/routes.py`, add the PATCH endpoint after the `debug_compile` function (after line 216), and update both list endpoints to support search and pinned-first sort.

Add this import at the top (line 1 area):

```python
from typing import Optional
```

Add the PATCH endpoint after `debug_compile` (after line 216):

```python
@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: uuid.UUID,
    body: ConversationUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    if body.title is not None:
        conv.title = body.title[:500]
    if body.is_pinned is not None:
        conv.is_pinned = body.is_pinned
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse(
        id=conv.id, title=conv.title, mode=conv.mode, is_pinned=conv.is_pinned,
        created_at=conv.created_at, updated_at=conv.updated_at,
    )
```

Also add `ConversationUpdate` to the imports from `app.chat.schemas` (line 12-16):

```python
from app.chat.schemas import (
    ChatRequest,
    ConversationListResponse,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
)
```

- [ ] **Step 2: Update list_personal_conversations with search and pinned sort**

Replace the `list_personal_conversations` function (lines 219-237):

```python
@router.get("/conversations/personal", response_model=ConversationListResponse)
async def list_personal_conversations(
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List conversations without a team (personal basic chat)."""
    query = select(Conversation).where(
        Conversation.team_id.is_(None), Conversation.user_id == user.id
    )
    if q:
        query = query.where(Conversation.title.ilike(f"%{q}%"))
    query = query.order_by(Conversation.is_pinned.desc(), Conversation.updated_at.desc())
    result = await db.execute(query)
    convs = result.scalars().all()
    return ConversationListResponse(conversations=[
        ConversationResponse(
            id=c.id, title=c.title, mode=c.mode, is_pinned=c.is_pinned,
            created_at=c.created_at, updated_at=c.updated_at,
        )
        for c in convs
    ])
```

- [ ] **Step 3: Update list_conversations with search and pinned sort**

Replace the `list_conversations` function (lines 240-262):

```python
@router.get("/conversations/{team_id}", response_model=ConversationListResponse)
async def list_conversations(
    team_id: uuid.UUID,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    query = select(Conversation).where(
        Conversation.team_id == team_id, Conversation.user_id == user.id
    )
    if q:
        query = query.where(Conversation.title.ilike(f"%{q}%"))
    query = query.order_by(Conversation.is_pinned.desc(), Conversation.updated_at.desc())
    result = await db.execute(query)
    convs = result.scalars().all()
    return ConversationListResponse(conversations=[
        ConversationResponse(
            id=c.id, title=c.title, mode=c.mode, is_pinned=c.is_pinned,
            created_at=c.created_at, updated_at=c.updated_at,
        )
        for c in convs
    ])
```

- [ ] **Step 4: Commit**

```bash
git add promptbase/backend/app/chat/routes.py
git commit -m "feat: add conversation PATCH, search, and pinned-first sort"
```

---

## Task 4: Backend — Conversation Auto-Naming

**Files:**
- Modify: `promptbase/backend/app/chat/service.py`
- Modify: `promptbase/backend/app/chat/routes.py`

- [ ] **Step 1: Add generate_title to service.py**

In `promptbase/backend/app/chat/service.py`, add this function after `stream_chat_response` (after line 239):

```python
async def generate_title(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    assistant_content: str,
    provider_name: str,
    llm_config: LLMConfig,
) -> str | None:
    """Generate an AI title for a conversation after the first exchange."""
    from app.providers.registry import get_provider

    # Only auto-name on the first exchange
    result = await db.execute(
        select(Message).where(Message.conversation_id == conversation.id)
    )
    msg_count = len(result.scalars().all())
    if msg_count != 2:
        return None

    provider = get_provider(provider_name)
    if not provider:
        return None

    prompt = "Summarize this conversation in 5-8 words as a title. Reply with only the title, no quotes."
    messages = [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": assistant_content[:200]},
    ]

    title_config = LLMConfig(
        model=llm_config.model,
        api_key=llm_config.api_key,
        base_url=llm_config.base_url,
        temperature=0.3,
        max_tokens=30,
    )

    try:
        title = ""
        async for token in provider.stream_chat(prompt, messages, title_config):
            title += token
        title = title.strip().strip('"').strip("'")[:200]
        if title:
            conversation.title = title
            await db.commit()
            return title
    except Exception:
        pass
    return None
```

- [ ] **Step 2: Update event_stream in routes.py to include new_title in DONE event**

In `promptbase/backend/app/chat/routes.py`, replace the `event_stream` inner function inside `chat_stream` (lines 129-157). The key changes are: capture the streamed content, call `generate_title` after streaming, and emit `new_title` in the DONE event.

Replace lines 129-157 with:

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

        full_text = ""
        try:
            async for event_type, content in stream_chat_response(
                db, conversation, body.message, prepared,
            ):
                escaped = content.replace("\n", "\\n")
                yield f"data: {event_type}:{escaped}\n\n"
                if event_type == "text":
                    full_text += content
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: [ERROR] {str(e)[:500]}\n\n"

        # Auto-generate title after first exchange
        new_title = None
        try:
            new_title = await generate_title(
                db, conversation, body.message, full_text,
                provider_name, llm_config,
            )
        except Exception:
            pass

        if new_title:
            yield f"data: [DONE]{_json.dumps({'new_title': new_title})}\n\n"
        else:
            yield "data: [DONE]\n\n"
```

Also add `generate_title` to the import from `app.chat.service` (line 18):

```python
from app.chat.service import generate_title, get_or_create_conversation, prepare_chat, stream_chat_response
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/backend/app/chat/service.py promptbase/backend/app/chat/routes.py
git commit -m "feat: auto-generate conversation titles via LLM after first exchange"
```

---

## Task 5: Backend — Personal Document Endpoints

**Files:**
- Modify: `promptbase/backend/app/documents/models.py`
- Modify: `promptbase/backend/app/documents/routes.py`
- Modify: `promptbase/backend/app/documents/schemas.py`

- [ ] **Step 1: Make team_id nullable in Document model**

In `promptbase/backend/app/documents/models.py`, change line 16:

From:
```python
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"))
```

To:
```python
    team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=True)
```

- [ ] **Step 2: Add personal document endpoints to routes.py**

In `promptbase/backend/app/documents/routes.py`, add these endpoints after the existing `upload_document` function (after line 53):

```python
@router.post("/personal/upload", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_personal_document(
    file: UploadFile,
    conversation_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    contents = await file.read()
    if len(contents) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    upload_dir = Path(settings.upload_dir) / "personal" / str(user.id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{uuid.uuid4()}_{file.filename}"
    file_path.write_bytes(contents)

    doc = Document(
        team_id=None, user_id=user.id, filename=file.filename,
        file_path=str(file_path), file_type=file.content_type or "application/octet-stream",
        file_size=len(contents), conversation_id=conversation_id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    process_document.delay(str(doc.id))

    return doc


@router.get("/personal", response_model=DocumentListResponse)
async def list_personal_documents(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(
            Document.team_id.is_(None), Document.user_id == user.id
        ).order_by(Document.created_at.desc())
    )
    return DocumentListResponse(documents=result.scalars().all())


@router.get("/personal/library", response_model=DocumentListResponse)
async def list_personal_library_documents(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(
            Document.team_id.is_(None),
            Document.user_id == user.id,
            Document.conversation_id.is_(None),
        ).order_by(Document.created_at.desc())
    )
    return DocumentListResponse(documents=result.scalars().all())


@router.delete("/personal/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_personal_document(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.team_id.is_(None),
            Document.user_id == user.id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from sqlalchemy import delete as sa_delete
    await db.execute(
        sa_delete(ConversationDocument).where(ConversationDocument.document_id == document_id)
    )

    file_path = Path(doc.file_path)
    if file_path.exists():
        file_path.unlink()

    await db.delete(doc)
    await db.commit()
```

**IMPORTANT:** These personal endpoints MUST be placed BEFORE the `/{team_id}` endpoints in the file, because FastAPI matches routes in order and `personal` would be captured as a `team_id` UUID otherwise. Move the personal endpoints to just after line 18 (after the router definition), or reorganize so they appear before the `/{team_id}/upload` route.

- [ ] **Step 3: Commit**

```bash
git add promptbase/backend/app/documents/models.py promptbase/backend/app/documents/routes.py promptbase/backend/app/documents/schemas.py
git commit -m "feat: add personal document upload/list/delete endpoints"
```

---

## Task 6: Backend — Admin Password Reset

**Files:**
- Modify: `promptbase/backend/app/admin/routes.py`

- [ ] **Step 1: Add password reset endpoint**

In `promptbase/backend/app/admin/routes.py`, add this endpoint after the `delete_user` function (after line 778):

```python
@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: uuid.UUID,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")

    new_password = body.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from app.auth.service import hash_password
    target.password_hash = hash_password(new_password)
    await db.commit()
    return {"success": True}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/backend/app/admin/routes.py
git commit -m "feat: add admin password reset endpoint"
```

---

## Task 7: Frontend — Types & SSE Updates

**Files:**
- Modify: `promptbase/frontend/src/types/index.ts`
- Modify: `promptbase/frontend/src/hooks/useSSE.ts`

- [ ] **Step 1: Add is_pinned to Conversation type**

In `promptbase/frontend/src/types/index.ts`, update the `Conversation` interface (lines 24-31):

```typescript
export interface Conversation {
  id: string
  title: string
  mode: string | null
  is_pinned: boolean
  created_at: string
  updated_at: string
  message_count: number
}
```

- [ ] **Step 2: Update useSSE to parse new_title from DONE event**

In `promptbase/frontend/src/hooks/useSSE.ts`, update the `SSEOptions` interface to add `onTitleGenerated` (lines 19-25):

```typescript
interface SSEOptions {
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onMeta: (meta: ChatMeta) => void
  onDone: () => void
  onError: (err: string) => void
  onTitleGenerated?: (title: string) => void
}
```

Then update the DONE handling in line 79. Replace:

```typescript
            if (data === '[DONE]') { opts.onDone(); return }
```

With:

```typescript
            if (data.startsWith('[DONE]')) {
              if (data.length > 6) {
                try {
                  const donePayload = JSON.parse(data.slice(6))
                  if (donePayload.new_title) {
                    opts.onTitleGenerated?.(donePayload.new_title)
                  }
                } catch {}
              }
              opts.onDone()
              return
            }
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/frontend/src/types/index.ts promptbase/frontend/src/hooks/useSSE.ts
git commit -m "feat: add is_pinned type and parse new_title from SSE DONE event"
```

---

## Task 8: Frontend — Typing Indicator Component

**Files:**
- Create: `promptbase/frontend/src/components/TypingIndicator.tsx`
- Modify: `promptbase/frontend/src/index.css`

- [ ] **Step 1: Create TypingIndicator component**

Create `promptbase/frontend/src/components/TypingIndicator.tsx`:

```tsx
import { Bot } from 'lucide-react'

export default function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-4 bg-gray-100 dark:bg-gray-900/40">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gray-300 dark:bg-gray-700">
        <Bot size={14} />
      </div>
      <div className="flex items-center gap-1 pt-2">
        <span className="typing-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0s' }} />
        <span className="typing-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0.2s' }} />
        <span className="typing-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0.4s' }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add typing indicator keyframes to index.css**

In `promptbase/frontend/src/index.css`, add after the existing content:

```css

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.typing-dot {
  animation: typing-bounce 1.4s infinite ease-in-out;
}
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/frontend/src/components/TypingIndicator.tsx promptbase/frontend/src/index.css
git commit -m "feat: add typing indicator component with bounce animation"
```

---

## Task 9: Frontend — Error Banner Component

**Files:**
- Create: `promptbase/frontend/src/components/ErrorBanner.tsx`

- [ ] **Step 1: Create ErrorBanner component**

Create `promptbase/frontend/src/components/ErrorBanner.tsx`:

```tsx
import { useEffect } from 'react'
import { AlertCircle, X, RotateCcw } from 'lucide-react'

interface Props {
  message: string
  onDismiss: () => void
  onRetry: () => void
}

export default function ErrorBanner({ message, onDismiss, onRetry }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10_000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  return (
    <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      <button
        onClick={onRetry}
        className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-800/50 hover:bg-red-200 dark:hover:bg-red-800 rounded transition-colors"
      >
        <RotateCcw size={10} /> Retry
      </button>
      <button onClick={onDismiss} className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-200">
        <X size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ErrorBanner.tsx
git commit -m "feat: add dismissible error banner with retry"
```

---

## Task 10: Frontend — Copy Message Button

**Files:**
- Modify: `promptbase/frontend/src/components/ChatMessage.tsx`

- [ ] **Step 1: Add copy button to ChatMessage**

Replace the entire `promptbase/frontend/src/components/ChatMessage.tsx` with:

```tsx
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Bot, Copy, Check } from 'lucide-react'
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
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`group/msg flex gap-3 px-4 py-4 ${isUser ? '' : 'bg-gray-100 dark:bg-gray-900/40'}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'
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
        <div className="prose dark:prose-invert prose-sm max-w-none overflow-x-hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="border-collapse border border-gray-300 dark:border-gray-700 text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-800 px-3 py-1.5 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-300 dark:border-gray-700 px-3 py-1.5">{children}</td>
              ),
              pre: ({ children }) => (
                <pre className="bg-gray-200 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs">
                  {children}
                </pre>
              ),
              code: ({ className, children }: any) => {
                const isBlock = /language-/.test(className || '')
                if (isBlock) {
                  return <code className={className}>{children}</code>
                }
                return (
                  <code className="bg-gray-200 dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 px-1 rounded text-xs">
                    {children}
                  </code>
                )
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5" />
          )}
        </div>
        {!isStreaming && message.id && !message.id.startsWith('temp-') && (
          <div className="flex items-center gap-2 pt-1">
            {!isUser && <span className="text-xs text-gray-400 dark:text-gray-600">{message.token_count} tokens</span>}
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover/msg:opacity-100 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
              title="Copy to clipboard"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            </button>
            {!isUser && <ExportButton messageId={message.id} />}
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
git commit -m "feat: add copy-to-clipboard button on chat messages"
```

---

## Task 11: Frontend — Mode Chips Component

**Files:**
- Create: `promptbase/frontend/src/components/ModeChips.tsx`

- [ ] **Step 1: Create ModeChips component**

Create `promptbase/frontend/src/components/ModeChips.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api } from '../api/client'
import type { TaskMode, Team } from '../types'

interface Props {
  teamId: string
  selectedMode: TaskMode | null
  detectedMode: string | null
  onModeChange: (mode: TaskMode | null) => void
}

export default function ModeChips({ teamId, selectedMode, detectedMode, onModeChange }: Props) {
  const { data: team } = useQuery<Team>({
    queryKey: ['team', teamId],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      return res.data.find((t: Team) => t.id === teamId) ?? null
    },
  })

  const { data: modes = [] } = useQuery<TaskMode[]>({
    queryKey: ['modes', team?.pack_id],
    enabled: !!team?.pack_id,
    queryFn: async () => {
      const res = await api.get(`/admin/packs/${team!.pack_id}/modes`)
      return res.data
    },
  })

  if (modes.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2">
      <Sparkles size={12} className="text-gray-400 shrink-0" />
      {modes.map((mode) => {
        const isSelected = selectedMode?.id === mode.id
        const isDetected = !selectedMode && detectedMode === mode.name
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onModeChange(isSelected ? null : mode)}
            title={mode.prompt_text?.slice(0, 100) || mode.name}
            className={`px-2 py-0.5 text-xs rounded-full border transition-all ${
              isSelected
                ? 'bg-indigo-600 text-white border-indigo-600'
                : isDetected
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
          >
            {mode.name}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ModeChips.tsx
git commit -m "feat: add mode chips component with selection and detected highlight"
```

---

## Task 12: Frontend — Context Menu Component

**Files:**
- Create: `promptbase/frontend/src/components/ContextMenu.tsx`

- [ ] **Step 1: Create ContextMenu component**

Create `promptbase/frontend/src/components/ContextMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react'

interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]"
      style={{ top: y, left: x }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose() }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
            item.danger
              ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ContextMenu.tsx
git commit -m "feat: add reusable context menu component"
```

---

## Task 13: Frontend — ConversationList with Search, Rename, Pin, Context Menu

**Files:**
- Modify: `promptbase/frontend/src/components/ConversationList.tsx`

- [ ] **Step 1: Rewrite ConversationList with all new features**

Replace the entire `promptbase/frontend/src/components/ConversationList.tsx`:

```tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Trash2, Pin, Search, Pencil } from 'lucide-react'
import { api } from '../api/client'
import type { Conversation } from '../types'
import ContextMenu from './ContextMenu'

interface Props {
  teamId: string | null
  activeId: string | null
  onSelect: (conv: Conversation) => void
  onDeleted: (convId: string) => void
}

export default function ConversationList({ teamId, activeId, onSelect, onDeleted }: Props) {
  const queryClient = useQueryClient()
  const queryKey = ['conversations', teamId ?? 'personal']
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; conv: Conversation } | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: [...queryKey, debouncedSearch],
    queryFn: async () => {
      const base = teamId ? `/chat/conversations/${teamId}` : '/chat/conversations/personal'
      const params = debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : ''
      const res = await api.get(`${base}${params}`)
      return res.data.conversations as Conversation[]
    },
    refetchInterval: 10_000,
  })

  const conversations = data ?? []
  const pinned = conversations.filter((c) => c.is_pinned)
  const unpinned = conversations.filter((c) => !c.is_pinned)

  const handleDelete = async (conv: Conversation) => {
    const deleteUrl = teamId
      ? `/chat/conversations/${teamId}/${conv.id}`
      : `/chat/conversations/personal/${conv.id}`
    await api.delete(deleteUrl)
    queryClient.invalidateQueries({ queryKey })
    if (conv.id === activeId) onDeleted(conv.id)
  }

  const handleTogglePin = async (conv: Conversation) => {
    await api.patch(`/chat/conversations/${conv.id}`, { is_pinned: !conv.is_pinned })
    queryClient.invalidateQueries({ queryKey })
  }

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id)
    setEditTitle(conv.title)
    setTimeout(() => editRef.current?.focus(), 50)
  }

  const saveRename = async () => {
    if (!editingId || !editTitle.trim()) { setEditingId(null); return }
    await api.patch(`/chat/conversations/${editingId}`, { title: editTitle.trim() })
    setEditingId(null)
    queryClient.invalidateQueries({ queryKey })
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, conv: Conversation) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, conv })
  }, [])

  const renderItem = (conv: Conversation) => {
    const isEditing = editingId === conv.id
    return (
      <div
        key={conv.id}
        onClick={() => !isEditing && onSelect(conv)}
        onDoubleClick={() => startRename(conv)}
        onContextMenu={(e) => handleContextMenu(e, conv)}
        className={`group w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
          conv.id === activeId
            ? 'bg-indigo-600/20 text-indigo-600 dark:text-indigo-300'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
        }`}
      >
        {conv.is_pinned && <Pin size={10} className="shrink-0 text-indigo-400 -rotate-45" />}
        {!conv.is_pinned && <MessageCircle size={14} className="shrink-0 text-gray-500" />}
        {isEditing ? (
          <input
            ref={editRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename()
              if (e.key === 'Escape') setEditingId(null)
            }}
            onBlur={saveRename}
            className="flex-1 bg-white dark:bg-gray-700 border border-indigo-400 rounded px-1 py-0.5 text-sm outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1">{conv.title || 'Untitled'}</span>
        )}
        {!isEditing && conv.mode && (
          <span className="shrink-0 text-xs text-gray-500 bg-gray-200 dark:bg-gray-800 rounded px-1.5 py-0.5 group-hover:hidden">
            {conv.mode}
          </span>
        )}
        {!isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(conv) }}
            className="hidden group-hover:block shrink-0 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete conversation"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-0.5">
      {/* Search */}
      <div className="relative px-1 mb-2">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg pl-7 pr-2 py-1.5 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Pinned */}
      {pinned.length > 0 && (
        <>
          <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pinned</p>
          {pinned.map(renderItem)}
          <div className="border-b border-gray-200 dark:border-gray-800 mx-2 my-1" />
        </>
      )}

      {/* History */}
      <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">History</p>
      {unpinned.map(renderItem)}
      {conversations.length === 0 && (
        <p className="px-3 py-2 text-sm text-gray-500">
          {debouncedSearch ? 'No matches' : 'No conversations yet'}
        </p>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: 'Rename', icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.conv) },
            { label: ctxMenu.conv.is_pinned ? 'Unpin' : 'Pin', icon: <Pin size={12} />, onClick: () => handleTogglePin(ctxMenu.conv) },
            { label: 'Delete', icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxMenu.conv), danger: true },
          ]}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ConversationList.tsx
git commit -m "feat: conversation search, inline rename, pin/unpin, context menu"
```

---

## Task 14: Frontend — ChatMain with Error Banner, Typing Indicator, Auto-Name

**Files:**
- Modify: `promptbase/frontend/src/components/ChatMain.tsx`

- [ ] **Step 1: Rewrite ChatMain with new features**

Replace the entire `promptbase/frontend/src/components/ChatMain.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useSSE, type ChatMeta } from '../hooks/useSSE'
import type { Team, Conversation, Message, TaskMode } from '../types'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import ExportButton from './ExportButton'
import ProcessTimeline from './ProcessTimeline'
import TypingIndicator from './TypingIndicator'
import ErrorBanner from './ErrorBanner'

interface Props {
  team: Team | null
  conversation: Conversation | null
  onConversationCreated: (conv: Conversation) => void
  onConversationTitleChanged: (convId: string, title: string) => void
  activeMode: TaskMode | null
  onModeChange: (mode: TaskMode | null) => void
  basicMode: boolean
}

export default function ChatMain({ team, conversation, onConversationCreated, onConversationTitleChanged, activeMode, onModeChange, basicMode }: Props) {
  const queryClient = useQueryClient()
  const { startStream, cancel } = useSSE()
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [thinkingBuffer, setThinkingBuffer] = useState('')
  const [hasTextStarted, setHasTextStarted] = useState(false)
  const hasTextStartedRef = useRef(false)
  const [conversationId, setConversationId] = useState<string | null>(conversation?.id ?? null)
  const [lastMeta, setLastMeta] = useState<ChatMeta | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const pendingFilesRef = useRef<File[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Error handling state
  const [error, setError] = useState<string | null>(null)
  const lastSendArgsRef = useRef<{ text: string; formData?: Record<string, string>; docIds?: string[] } | null>(null)
  const streamConvIdRef = useRef<string | null>(null)

  const teamId = team?.id ?? null
  const queryNs = teamId ?? 'personal'
  const convQueryKey = ['conversations', queryNs]

  useEffect(() => {
    setConversationId(conversation?.id ?? null)
  }, [conversation])

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['messages', queryNs, conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const url = teamId
        ? `/chat/conversations/${teamId}/${conversationId}/messages`
        : `/chat/conversations/personal/${conversationId}/messages`
      const res = await api.get(url)
      return res.data
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer, thinkingBuffer])

  const handleSend = useCallback(async (text: string, formData?: Record<string, string>, docIds?: string[]) => {
    let message = text
    if (formData && Object.keys(formData).length > 0) {
      const fields = Object.entries(formData)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n')
      message = text ? `${text}\n\n${fields}` : fields
    }

    // Store for retry
    lastSendArgsRef.current = { text, formData, docIds }
    setError(null)

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
      ['messages', queryNs, conversationId],
      (old) => [...(old ?? []), tempUserMsg]
    )

    await startStream(
      {
        message,
        team_id: teamId,
        conversation_id: conversationId,
        document_ids: docIds ?? [],
        mode: activeMode?.name ?? null,
        basic_mode: basicMode,
      },
      {
        onMeta: (meta) => {
          setLastMeta(meta)
          setConversationId(meta.conversation_id)
          streamConvIdRef.current = meta.conversation_id
          queryClient.invalidateQueries({ queryKey: convQueryKey })
          if (!conversationId) {
            onConversationCreated({
              id: meta.conversation_id, title: message.slice(0, 60), mode: meta.mode_detected,
              is_pinned: false,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              message_count: 1,
            })
          }
          // Upload queued files now that conversation exists
          const filesToUpload = pendingFilesRef.current
          if (filesToUpload.length > 0) {
            const cid = meta.conversation_id
            pendingFilesRef.current = []
            setPendingFiles([])
            const uploadBase = teamId ? `/documents/${teamId}/upload` : '/documents/personal/upload'
            Promise.all(
              filesToUpload.map((file) => {
                const form = new FormData()
                form.append('file', file)
                return api.post(`${uploadBase}?conversation_id=${cid}`, form, {
                  headers: { 'Content-Type': 'multipart/form-data' },
                })
              })
            ).then(() => {
              queryClient.invalidateQueries({ queryKey: ['conversation-docs', cid] })
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
        onTitleGenerated: (title) => {
          const cid = streamConvIdRef.current
          if (cid) {
            onConversationTitleChanged(cid, title)
            queryClient.invalidateQueries({ queryKey: convQueryKey })
          }
        },
        onDone: () => {
          setIsStreaming(false)
          setStreamBuffer('')
          setThinkingBuffer('')
          setHasTextStarted(false)
          hasTextStartedRef.current = false
          if (conversationId) {
            queryClient.invalidateQueries({ queryKey: ['messages', queryNs, conversationId] })
          }
        },
        onError: (err) => {
          setIsStreaming(false)
          setStreamBuffer('')
          setThinkingBuffer('')
          setHasTextStarted(false)
          hasTextStartedRef.current = false
          setError(err)
        },
      }
    )
  }, [teamId, queryNs, conversationId, convQueryKey, activeMode, basicMode, startStream, queryClient, onConversationCreated, onConversationTitleChanged])

  const handleRetry = useCallback(() => {
    if (lastSendArgsRef.current) {
      const { text, formData, docIds } = lastSendArgsRef.current
      setError(null)
      handleSend(text, formData, docIds)
    }
  }, [handleSend])

  const showTypingIndicator = isStreaming && !streamBuffer && !thinkingBuffer

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white">
            {conversation?.title ?? 'New Conversation'}
          </h1>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
            <span>{team?.name ?? 'Personal Chat'}</span>
            {lastMeta?.model && (
              <>
                <span className="text-gray-400 dark:text-gray-700">&middot;</span>
                <span className="text-emerald-600 dark:text-emerald-400">{lastMeta.model}</span>
              </>
            )}
            {lastMeta?.mode_detected && (
              <>
                <span className="text-gray-400 dark:text-gray-700">&middot;</span>
                <span className="text-indigo-600 dark:text-indigo-400">{lastMeta.mode_detected} mode</span>
              </>
            )}
            {activeMode && !lastMeta?.mode_detected && (
              <>
                <span className="text-gray-400 dark:text-gray-700">&middot;</span>
                <span className="text-indigo-600 dark:text-indigo-400">{activeMode.name} mode</span>
              </>
            )}
          </div>
        </div>
        {conversationId && (
          <ExportButton conversationId={conversationId} label="Export" />
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-200/50 dark:divide-gray-800/50">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-500 gap-3">
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
              {basicMode ? 'Basic Chat' : 'Start a conversation'}
            </p>
            <p className="text-sm">
              {basicMode
                ? 'Plain chat — no prompt pack, just you and the model.'
                : 'Type a message below. Mode auto-detects from your message.'}
            </p>
            {!basicMode && (
              <p className="text-xs text-gray-400 dark:text-gray-600">analysis · solution design · implementation · tender response · architecture review · business process</p>
            )}
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={msg.id}>
            <ChatMessage message={msg} />
            {!basicMode && msg.role === 'user' && idx === messages.length - 1 && lastMeta && !isStreaming && (
              <ProcessTimeline meta={lastMeta} />
            )}
          </div>
        ))}
        {!basicMode && isStreaming && lastMeta && (
          <ProcessTimeline meta={lastMeta} />
        )}
        {showTypingIndicator && <TypingIndicator />}
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

      {/* Error banner */}
      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          onRetry={handleRetry}
        />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={cancel}
        isStreaming={isStreaming}
        activeMode={activeMode}
        onModeChange={onModeChange}
        detectedMode={lastMeta?.mode_detected ?? null}
        teamId={teamId}
        conversationId={conversationId}
        basicMode={basicMode}
        onUploadQueued={(files) => { pendingFilesRef.current = files; setPendingFiles(files) }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ChatMain.tsx
git commit -m "feat: add error banner, typing indicator, auto-name, and retry to ChatMain"
```

---

## Task 15: Frontend — ChatInput with Mode Chips and Personal Docs

**Files:**
- Modify: `promptbase/frontend/src/components/ChatInput.tsx`

- [ ] **Step 1: Rewrite ChatInput with mode chips and personal doc support**

Replace the entire `promptbase/frontend/src/components/ChatInput.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useConversationDocs } from '../hooks/useDocumentStatus'
import TaskForm from './TaskForm'
import AttachButton from './AttachButton'
import AttachedDocs from './AttachedDocs'
import ModeChips from './ModeChips'
import type { TaskMode, Document } from '../types'

interface Props {
  onSend: (message: string, formData?: Record<string, string>, docIds?: string[]) => void
  onCancel: () => void
  isStreaming: boolean
  activeMode: TaskMode | null
  onModeChange: (mode: TaskMode | null) => void
  detectedMode: string | null
  teamId: string | null
  conversationId: string | null
  basicMode: boolean
  onUploadQueued: (files: File[]) => void
}

export default function ChatInput({ onSend, onCancel, isStreaming, activeMode, onModeChange, detectedMode, teamId, conversationId, basicMode, onUploadQueued }: Props) {
  const [text, setText] = useState('')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [attachedDocs, setAttachedDocs] = useState<Document[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { data: conversationDocs = [] } = useConversationDocs(conversationId)

  useEffect(() => {
    if (conversationDocs.length > 0) {
      setAttachedDocs(conversationDocs)
    }
  }, [conversationDocs])

  useEffect(() => {
    setQueuedFiles([])
    setAttachedDocs([])
  }, [conversationId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (!message && !activeMode?.form_schema) return

    const docIds = attachedDocs.filter((d) => d.status === 'ready').map((d) => d.id)

    if (queuedFiles.length > 0) {
      onUploadQueued(queuedFiles)
      setQueuedFiles([])
    }

    onSend(message, Object.keys(formData).length > 0 ? formData : undefined, docIds.length > 0 ? docIds : undefined)
    setText('')
    setFormData({})
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileQueued = (file: File) => {
    setQueuedFiles((prev) => [...prev, file])
  }

  const handleDocAttached = (doc: Document) => {
    setAttachedDocs((prev) => {
      if (prev.find((d) => d.id === doc.id)) return prev
      return [...prev, doc]
    })
  }

  const handleRemoveDoc = async (docId: string, isLibrary: boolean) => {
    setAttachedDocs((prev) => prev.filter((d) => d.id !== docId))
    if (isLibrary && conversationId) {
      await api.delete(`/documents/conversation/${conversationId}/detach/${docId}`)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    } else if (!isLibrary && conversationId) {
      const deleteBase = teamId ? `/documents/${teamId}/${docId}` : `/documents/personal/${docId}`
      await api.delete(deleteBase)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    }
  }

  const handleRemoveQueued = (index: number) => {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const docPills = attachedDocs.map((d) => ({
    id: d.id,
    filename: d.filename,
    status: d.status,
    progress: d.progress ?? 0,
    isLibrary: !d.conversation_id,
  }))

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
      {activeMode?.form_schema && (
        <div className="mb-3">
          <TaskForm schema={activeMode.form_schema} values={formData} onChange={setFormData} />
        </div>
      )}
      {/* Mode chips */}
      {teamId && !basicMode && (
        <ModeChips
          teamId={teamId}
          selectedMode={activeMode}
          detectedMode={detectedMode}
          onModeChange={onModeChange}
        />
      )}
      <AttachedDocs
        docs={docPills}
        queuedFiles={queuedFiles}
        onRemove={handleRemoveDoc}
        onRemoveQueued={handleRemoveQueued}
      />
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <AttachButton
          teamId={teamId}
          conversationId={conversationId}
          onFileQueued={handleFileQueued}
          onDocAttached={handleDocAttached}
          disabled={isStreaming}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isStreaming}
          placeholder={activeMode ? `${activeMode.name} — describe your request…` : 'Message…'}
          className="flex-1 resize-none bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-48 overflow-y-auto"
          style={{ fieldSizing: 'content' } as any}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex-shrink-0 w-10 h-10 bg-red-700 hover:bg-red-600 rounded-xl flex items-center justify-center transition-colors"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() && !activeMode?.form_schema}
            className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
          >
            <Send size={16} />
          </button>
        )}
      </form>
      <p className="text-xs text-gray-400 dark:text-gray-600 mt-2 text-center">Enter to send · Shift+Enter for newline</p>
    </div>
  )
}
```

Note: The `AttachButton` is now always rendered (not conditionally on `teamId`). We'll update AttachButton in Task 17 to handle null teamId.

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ChatInput.tsx
git commit -m "feat: add mode chips and personal document support to ChatInput"
```

---

## Task 16: Frontend — ChatSidebar & ChatPage Updates

**Files:**
- Modify: `promptbase/frontend/src/components/ChatSidebar.tsx`
- Modify: `promptbase/frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Remove ModeSelector from ChatSidebar**

Replace the entire `promptbase/frontend/src/components/ChatSidebar.tsx`:

```tsx
import { PlusCircle, LogOut, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Team, Conversation, TaskMode } from '../types'
import ConversationList from './ConversationList'
import ThemeToggle from './ThemeToggle'

interface Props {
  teams: Team[]
  activeTeam: Team | null
  onSelectTeam: (team: Team | null) => void
  activeConversation: Conversation | null
  onSelectConversation: (conv: Conversation) => void
  onNewConversation: () => void
  basicMode: boolean
  onBasicModeChange: (basic: boolean) => void
  onConversationDeleted: () => void
}

export default function ChatSidebar({
  teams, activeTeam, onSelectTeam,
  activeConversation, onSelectConversation, onNewConversation,
  basicMode, onBasicModeChange, onConversationDeleted,
}: Props) {
  const { user, logout } = useAuth()
  const hasTeams = teams.length > 0

  return (
    <aside className="w-72 flex flex-col bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shrink-0">
      {/* Team selector */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <select
          value={activeTeam?.id ?? 'personal'}
          onChange={(e) => {
            if (e.target.value === 'personal') {
              onSelectTeam(null)
            } else {
              const team = teams.find((t) => t.id === e.target.value)
              if (team) onSelectTeam(team)
            }
          }}
          className="w-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="personal">Personal Chat</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* New chat + mode toggle */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <PlusCircle size={16} />
          New Chat
        </button>
        {hasTeams && activeTeam && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Chat mode</span>
            <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => onBasicModeChange(true)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  basicMode ? 'bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Basic
              </button>
              <button
                onClick={() => onBasicModeChange(false)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  !basicMode ? 'bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Advanced
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto">
        <ConversationList
          teamId={activeTeam?.id ?? null}
          activeId={activeConversation?.id ?? null}
          onSelect={onSelectConversation}
          onDeleted={() => onConversationDeleted()}
        />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.name}</span>
        <div className="flex gap-2">
          <ThemeToggle />
          {user?.is_super_admin && (
            <Link to="/admin" className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded transition-colors" title="Admin">
              <Settings size={16} />
            </Link>
          )}
          <button onClick={logout} className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded transition-colors" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Update ChatPage to pass new props**

Replace the entire `promptbase/frontend/src/pages/ChatPage.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Team, Conversation, TaskMode } from '../types'
import ChatSidebar from '../components/ChatSidebar'
import ChatMain from '../components/ChatMain'

export default function ChatPage() {
  const queryClient = useQueryClient()
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [teamInitialized, setTeamInitialized] = useState(false)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeMode, setActiveMode] = useState<TaskMode | null>(null)
  const [basicMode, setBasicMode] = useState(false)

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      const data = res.data
      if (!teamInitialized) {
        if (data.length > 0) setActiveTeam(data[0])
        setTeamInitialized(true)
      }
      return data
    },
  })

  const effectiveBasicMode = !activeTeam ? true : basicMode

  const handleTitleChanged = useCallback((convId: string, title: string) => {
    setActiveConversation((prev) => prev && prev.id === convId ? { ...prev, title } : prev)
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }, [queryClient])

  return (
    <div className="flex h-screen bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-100 overflow-hidden">
      <ChatSidebar
        teams={teams}
        activeTeam={activeTeam}
        onSelectTeam={(team) => {
          setActiveTeam(team)
          setActiveConversation(null)
          setActiveMode(null)
          if (!team) setBasicMode(true)
        }}
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
        onNewConversation={() => {
          setActiveConversation(null)
          setActiveMode(null)
        }}
        basicMode={effectiveBasicMode}
        onBasicModeChange={setBasicMode}
        onConversationDeleted={() => setActiveConversation(null)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatMain
          team={activeTeam}
          conversation={activeConversation}
          onConversationCreated={setActiveConversation}
          onConversationTitleChanged={handleTitleChanged}
          activeMode={activeTeam ? activeMode : null}
          onModeChange={setActiveMode}
          basicMode={effectiveBasicMode}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/frontend/src/components/ChatSidebar.tsx promptbase/frontend/src/pages/ChatPage.tsx
git commit -m "feat: remove ModeSelector from sidebar, wire up auto-name and mode chips"
```

---

## Task 17: Frontend — AttachButton & Document Hooks for Personal Docs

**Files:**
- Modify: `promptbase/frontend/src/components/AttachButton.tsx`
- Modify: `promptbase/frontend/src/hooks/useDocumentStatus.ts`

- [ ] **Step 1: Update AttachButton to handle null teamId**

Replace the entire `promptbase/frontend/src/components/AttachButton.tsx`:

```tsx
import { useState, useRef } from 'react'
import { Paperclip, Upload, Library, Loader2, FileText, FolderUp, CheckCircle2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLibraryDocs } from '../hooks/useDocumentStatus'
import type { Document } from '../types'

interface Props {
  teamId: string | null
  conversationId: string | null
  onFileQueued: (file: File) => void
  onDocAttached: (doc: Document) => void
  disabled: boolean
}

export default function AttachButton({ teamId, conversationId, onFileQueued, onDocAttached, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<'conversation' | 'library'>('conversation')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const uploadBase = teamId ? `/documents/${teamId}` : '/documents/personal'
  const { data: libraryDocs = [] } = useLibraryDocs(teamId)

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    if (uploadTarget === 'library') {
      setOpen(false)
      setUploading(true)
      try {
        for (const file of Array.from(files)) {
          const form = new FormData()
          form.append('file', file)
          await api.post(`${uploadBase}/upload`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        }
        queryClient.invalidateQueries({ queryKey: ['library-docs', teamId ?? 'personal'] })
        setOpen(true)
        setShowLibrary(true)
      } catch (err) {
        console.error('Upload failed:', err)
      } finally {
        setUploading(false)
        setUploadTarget('conversation')
      }
      return
    }

    setOpen(false)

    if (!conversationId) {
      for (const file of Array.from(files)) {
        onFileQueued(file)
      }
      return
    }

    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const res = await api.post(
          `${uploadBase}/upload?conversation_id=${conversationId}`,
          form,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        )
        onDocAttached(res.data)
      }
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  const handleAttachFromLibrary = async (doc: Document) => {
    if (doc.status !== 'ready') return
    setOpen(false)
    setShowLibrary(false)

    if (!conversationId) {
      onDocAttached(doc)
      return
    }

    try {
      await api.post(`/documents/conversation/${conversationId}/attach`, {
        document_id: doc.id,
      })
      onDocAttached(doc)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    } catch (err) {
      console.error('Attach failed:', err)
    }
  }

  const statusIndicator = (doc: Document) => {
    if (doc.status === 'ready') return <CheckCircle2 size={12} className="text-green-400 shrink-0" />
    if (doc.status === 'failed') return <span className="text-red-400 text-[10px]">failed</span>
    return <span className="text-indigo-400 text-[10px] tabular-nums">{doc.progress ?? 0}%</span>
  }

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.csv"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      <button
        type="button"
        onClick={() => { setOpen(!open); setShowLibrary(false) }}
        disabled={disabled || uploading}
        className="flex-shrink-0 w-10 h-10 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
        title="Attach document"
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
      </button>

      {open && (
        <div className="absolute bottom-12 left-0 w-64 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
          {!showLibrary ? (
            <>
              <button
                onClick={() => { setUploadTarget('conversation'); fileInputRef.current?.click(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Upload size={14} />
                Upload to chat
              </button>
              <button
                onClick={() => { setUploadTarget('library'); fileInputRef.current?.click() }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-t border-gray-300 dark:border-gray-700"
              >
                <FolderUp size={14} />
                Upload to library
              </button>
              <button
                onClick={() => setShowLibrary(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-t border-gray-300 dark:border-gray-700"
              >
                <Library size={14} />
                From library {libraryDocs.length > 0 && <span className="text-gray-400 dark:text-gray-600 text-xs">({libraryDocs.length})</span>}
              </button>
            </>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300 dark:border-gray-700">
                <button
                  onClick={() => setShowLibrary(false)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  ← Back
                </button>
                <span className="text-xs text-gray-400 dark:text-gray-600">{teamId ? 'Team' : 'Personal'} Library</span>
              </div>
              {libraryDocs.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-500 text-center">No library documents yet.<br />Upload one with "Upload to library".</p>
              ) : (
                libraryDocs.map((doc) => {
                  const isReady = doc.status === 'ready'
                  return (
                    <button
                      key={doc.id}
                      onClick={() => isReady && handleAttachFromLibrary(doc)}
                      disabled={!isReady}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        isReady
                          ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                          : 'text-gray-400 dark:text-gray-500 cursor-default'
                      }`}
                      title={!isReady ? 'Still processing...' : doc.filename}
                    >
                      <FileText size={12} className="text-gray-500 shrink-0" />
                      <span className="truncate flex-1 text-left">{doc.filename}</span>
                      {statusIndicator(doc)}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update useDocumentStatus hooks for personal docs**

Replace the entire `promptbase/frontend/src/hooks/useDocumentStatus.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Document } from '../types'

export function useDocuments(teamId: string) {
  return useQuery<Document[]>({
    queryKey: ['documents', teamId],
    queryFn: async () => {
      const res = await api.get(`/documents/${teamId}`)
      return res.data.documents
    },
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      const hasActive = docs.some(
        (d) => d.status === 'pending' || d.status === 'processing'
      )
      return hasActive ? 3_000 : false
    },
  })
}

export function useLibraryDocs(teamId: string | null) {
  const key = teamId ?? 'personal'
  const url = teamId ? `/documents/${teamId}/library` : '/documents/personal/library'
  return useQuery<Document[]>({
    queryKey: ['library-docs', key],
    queryFn: async () => {
      const res = await api.get(url)
      return res.data.documents
    },
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      const hasActive = docs.some(
        (d) => d.status === 'pending' || d.status === 'processing'
      )
      return hasActive ? 3_000 : false
    },
  })
}

export function useConversationDocs(conversationId: string | null) {
  return useQuery<Document[]>({
    queryKey: ['conversation-docs', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await api.get(`/documents/conversation/${conversationId}`)
      return res.data.documents
    },
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      const hasActive = docs.some(
        (d) => d.status === 'pending' || d.status === 'processing'
      )
      return hasActive ? 3_000 : false
    },
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/frontend/src/components/AttachButton.tsx promptbase/frontend/src/hooks/useDocumentStatus.ts
git commit -m "feat: support personal documents in AttachButton and document hooks"
```

---

## Task 18: Frontend — Admin Password Reset

**Files:**
- Create: `promptbase/frontend/src/components/ResetPasswordModal.tsx`
- Modify: `promptbase/frontend/src/pages/admin/AdminUsers.tsx`

- [ ] **Step 1: Create ResetPasswordModal component**

Create `promptbase/frontend/src/components/ResetPasswordModal.tsx`:

```tsx
import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface Props {
  userId: string
  userName: string
  onClose: () => void
}

export default function ResetPasswordModal({ userId, userName, onClose }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }

    setLoading(true)
    try {
      await api.post(`/admin/users/${userId}/reset-password`, { new_password: password })
      setSuccess(true)
      setTimeout(onClose, 1500)
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-800 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Reset Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Set a new password for <strong>{userName}</strong></p>

        {success ? (
          <div className="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm">
            Password reset successfully.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-300 text-sm">
                {error}
              </div>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Reset Password
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add reset button to AdminUsers**

Replace the entire `promptbase/frontend/src/pages/admin/AdminUsers.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ShieldCheck, Trash2, Building2, KeyRound } from 'lucide-react'
import { api } from '../../api/client'
import ResetPasswordModal from '../../components/ResetPasswordModal'

interface TeamMembership {
  team_id: string
  team_name: string
  role: string
}

interface UserInfo {
  id: string
  email: string
  name: string
  is_super_admin: boolean
  is_active: boolean
  created_at: string
  teams: TeamMembership[]
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
}

export default function AdminUsers() {
  const qc = useQueryClient()
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: me } = useQuery<UserInfo>({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  const { data: users = [], isLoading } = useQuery<UserInfo[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get('/admin/users')).data,
  })

  const deleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return
    try {
      await api.delete(`/admin/users/${userId}`)
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (err: any) {
      alert(err.response?.data?.detail ?? 'Failed to delete user')
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {users.length} registered user{users.length !== 1 ? 's' : ''} — invite via Teams page
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-500" /></div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-semibold text-sm text-white shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{u.name}</span>
                    {u.is_super_admin && (
                      <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 rounded px-1.5 py-0.5">
                        <ShieldCheck size={10} />
                        Super Admin
                      </span>
                    )}
                    {!u.is_active && (
                      <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                        Inactive
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{u.email}</span>
                  {u.teams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {u.teams.map((t) => (
                        <span
                          key={t.team_id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50"
                        >
                          <Building2 size={10} />
                          {t.team_name}
                          <span className="text-indigo-400 dark:text-indigo-500">{ROLE_LABEL[t.role] ?? t.role}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">No team</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(u.created_at).toLocaleDateString()}
                </span>
                {me && u.id !== me.id && (
                  <>
                    <button
                      onClick={() => setResetTarget({ id: u.id, name: u.name })}
                      className="p-1.5 text-gray-400 hover:text-indigo-500 transition-colors shrink-0"
                      title="Reset password"
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      onClick={() => deleteUser(u.id, u.name)}
                      className="p-1.5 text-gray-400 hover:text-red-400 transition-colors shrink-0"
                      title="Delete user"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {resetTarget && (
        <ResetPasswordModal
          userId={resetTarget.id}
          userName={resetTarget.name}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add promptbase/frontend/src/components/ResetPasswordModal.tsx promptbase/frontend/src/pages/admin/AdminUsers.tsx
git commit -m "feat: add admin password reset modal and button"
```

---

## Task 19: Cleanup — Remove ModeSelector

**Files:**
- Delete: `promptbase/frontend/src/components/ModeSelector.tsx`

- [ ] **Step 1: Remove unused ModeSelector component**

```bash
rm promptbase/frontend/src/components/ModeSelector.tsx
```

- [ ] **Step 2: Verify no remaining imports**

Run: `grep -r "ModeSelector" promptbase/frontend/src/`
Expected: No results (already removed from ChatSidebar in Task 16)

- [ ] **Step 3: Commit**

```bash
git add -A promptbase/frontend/src/components/ModeSelector.tsx
git commit -m "chore: remove unused ModeSelector component"
```

---

## Task 20: Integration Verification

- [ ] **Step 1: Check TypeScript compiles**

Run: `cd promptbase/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Check backend imports**

Run: `cd promptbase/backend && python -c "from app.chat.routes import router; from app.documents.routes import router; from app.admin.routes import router; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Start dev server and smoke test**

Run: `cd promptbase/frontend && npm run dev`
Check:
- Login page loads
- Chat page loads with sidebar search box
- Mode chips appear in advanced mode with a team
- Personal chat shows attach button
- Admin users page shows reset password button

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: integration fixes from smoke test"
```

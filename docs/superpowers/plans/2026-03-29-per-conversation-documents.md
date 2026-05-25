# Per-Conversation Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move document uploads from team-level sidebar to per-conversation inline attach via a paperclip button on the chat input, with a team library for reusable documents.

**Architecture:** Add `conversation_id` FK to Document model. New API endpoints for library listing, conversation docs, attach/detach. Frontend removes sidebar DocumentUpload, adds AttachButton + AttachedDocs to ChatInput, manages doc state at ChatInput level with queued uploads for new conversations.

**Tech Stack:** Python/FastAPI (backend), React 19/TypeScript/Tailwind (frontend), PostgreSQL (migration), Alembic

---

## File Structure

| File | Role |
|------|------|
| `promptbase/backend/app/documents/models.py` | **Modify:** Add `conversation_id` FK to Document |
| `promptbase/backend/app/documents/schemas.py` | **Modify:** Add `conversation_id` to DocumentResponse, add AttachRequest schema |
| `promptbase/backend/app/documents/routes.py` | **Modify:** Add `conversation_id` param to upload, add library/conversation/attach/detach endpoints |
| `promptbase/backend/alembic/versions/xxxx_add_conversation_id.py` | **Create:** Migration |
| `promptbase/frontend/src/hooks/useDocumentStatus.ts` | **Modify:** Add `useConversationDocs` and `useLibraryDocs` hooks |
| `promptbase/frontend/src/components/AttachButton.tsx` | **Create:** Paperclip dropdown (upload + library) |
| `promptbase/frontend/src/components/AttachedDocs.tsx` | **Create:** Pill display for attached documents |
| `promptbase/frontend/src/components/ChatInput.tsx` | **Modify:** Add AttachButton + AttachedDocs, manage doc state |
| `promptbase/frontend/src/components/ChatMain.tsx` | **Modify:** Remove `selectedDocIds` prop, pass team/conversationId to ChatInput |
| `promptbase/frontend/src/pages/ChatPage.tsx` | **Modify:** Remove `selectedDocIds` state and DocumentUpload props |
| `promptbase/frontend/src/components/ChatSidebar.tsx` | **Modify:** Remove DocumentUpload section and `onDocumentsChange` prop |
| `promptbase/frontend/src/types/index.ts` | **Modify:** Add `conversation_id` to Document type |

---

### Task 1: Backend — Add conversation_id to Document model + migration

**Files:**
- Modify: `promptbase/backend/app/documents/models.py:12-28`
- Modify: `promptbase/backend/app/documents/schemas.py:7-17`
- Create: `promptbase/backend/alembic/versions/xxxx_add_conversation_id_to_documents.py`

- [ ] **Step 1: Add conversation_id FK to Document model**

In `promptbase/backend/app/documents/models.py`, add after line 17 (`user_id` column):

```python
conversation_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True
)
```

- [ ] **Step 2: Add conversation_id to DocumentResponse schema**

In `promptbase/backend/app/documents/schemas.py`, add to `DocumentResponse` after `status`:

```python
class DocumentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    file_size: int
    status: str
    strategy: str | None
    token_count: int
    conversation_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: Add AttachRequest schema**

In `promptbase/backend/app/documents/schemas.py`, add:

```python
class AttachRequest(BaseModel):
    document_id: uuid.UUID
```

- [ ] **Step 4: Create Alembic migration manually**

Create `promptbase/backend/alembic/versions/a1b2c3d4e5f6_add_conversation_id_to_documents.py`:

```python
"""add conversation_id to documents

Revision ID: a1b2c3d4e5f6
Revises: 84f5bb4220a5
Create Date: 2026-03-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '84f5bb4220a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('documents', sa.Column('conversation_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_documents_conversation_id', 'documents', 'conversations',
        ['conversation_id'], ['id'], ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('fk_documents_conversation_id', 'documents', type_='foreignkey')
    op.drop_column('documents', 'conversation_id')
```

- [ ] **Step 5: Verify migration chain**

Check that the `down_revision` matches the previous migration. Read the filename of the thinking_content migration:

Run: `ls promptbase/backend/alembic/versions/`

Adjust `down_revision` if the hash doesn't match `84f5bb4220a5`.

- [ ] **Step 6: Commit**

```bash
git add promptbase/backend/app/documents/models.py promptbase/backend/app/documents/schemas.py promptbase/backend/alembic/versions/
git commit -m "feat: add conversation_id to Document model with migration"
```

---

### Task 2: Backend — New API endpoints (library, conversation docs, attach, detach)

**Files:**
- Modify: `promptbase/backend/app/documents/routes.py`

- [ ] **Step 1: Add conversation_id param to upload endpoint**

In `promptbase/backend/app/documents/routes.py`, modify the `upload_document` function signature to accept an optional `conversation_id` query param, and pass it to the Document constructor.

Replace lines 20-51:

```python
@router.post("/{team_id}/upload", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    team_id: uuid.UUID,
    file: UploadFile,
    conversation_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this team")

    contents = await file.read()
    if len(contents) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    upload_dir = Path(settings.upload_dir) / str(team_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{uuid.uuid4()}_{file.filename}"
    file_path.write_bytes(contents)

    doc = Document(
        team_id=team_id, user_id=user.id, filename=file.filename,
        file_path=str(file_path), file_type=file.content_type or "application/octet-stream",
        file_size=len(contents), conversation_id=conversation_id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    process_document.delay(str(doc.id))

    return doc
```

- [ ] **Step 2: Add library endpoint**

Add after the existing `list_documents` endpoint:

```python
@router.get("/{team_id}/library", response_model=DocumentListResponse)
async def list_library_documents(
    team_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List team-level library documents (not scoped to any conversation)."""
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(
        select(Document).where(
            Document.team_id == team_id,
            Document.conversation_id.is_(None),
            Document.status == "ready",
        ).order_by(Document.created_at.desc())
    )
    return DocumentListResponse(documents=result.scalars().all())
```

- [ ] **Step 3: Add conversation documents endpoint**

Add the import for `ConversationDocument` at the top of the file:

```python
from app.chat.models import ConversationDocument
```

Then add the endpoint:

```python
@router.get("/conversation/{conversation_id}", response_model=DocumentListResponse)
async def list_conversation_documents(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all documents for a conversation (direct + attached from library)."""
    # Direct per-conversation documents
    direct = await db.execute(
        select(Document).where(Document.conversation_id == conversation_id)
    )
    direct_docs = list(direct.scalars().all())

    # Library docs attached via junction table
    attached = await db.execute(
        select(Document).join(
            ConversationDocument, Document.id == ConversationDocument.document_id
        ).where(ConversationDocument.conversation_id == conversation_id)
    )
    attached_docs = list(attached.scalars().all())

    # Combine, dedup by id
    seen = set()
    all_docs = []
    for doc in direct_docs + attached_docs:
        if doc.id not in seen:
            seen.add(doc.id)
            all_docs.append(doc)

    return DocumentListResponse(documents=all_docs)
```

- [ ] **Step 4: Add attach endpoint**

```python
from app.documents.schemas import AttachRequest, DocumentListResponse, DocumentResponse

@router.post("/conversation/{conversation_id}/attach", status_code=status.HTTP_201_CREATED)
async def attach_library_document(
    conversation_id: uuid.UUID,
    body: AttachRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Attach a library document to a conversation."""
    link = ConversationDocument(conversation_id=conversation_id, document_id=body.document_id)
    db.add(link)
    await db.commit()
    return {"status": "attached"}
```

- [ ] **Step 5: Add detach endpoint**

```python
@router.delete("/conversation/{conversation_id}/detach/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def detach_library_document(
    conversation_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Detach a library document from a conversation."""
    result = await db.execute(
        select(ConversationDocument).where(
            ConversationDocument.conversation_id == conversation_id,
            ConversationDocument.document_id == document_id,
        )
    )
    link = result.scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()
```

- [ ] **Step 6: Update the import for AttachRequest at the top of routes.py**

Make sure the import line reads:

```python
from app.documents.schemas import AttachRequest, DocumentListResponse, DocumentResponse
```

- [ ] **Step 7: Run tests**

Run: `cd promptbase/backend && python3 -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add promptbase/backend/app/documents/routes.py
git commit -m "feat: add library, conversation docs, attach/detach endpoints"
```

---

### Task 3: Frontend — Update types and document hooks

**Files:**
- Modify: `promptbase/frontend/src/types/index.ts:42-50`
- Modify: `promptbase/frontend/src/hooks/useDocumentStatus.ts`

- [ ] **Step 1: Add conversation_id to Document type**

In `promptbase/frontend/src/types/index.ts`, update the `Document` interface:

```typescript
export interface Document {
  id: string
  filename: string
  file_type: string
  file_size: number
  status: 'pending' | 'processing' | 'ready' | 'failed'
  strategy: 'full_inject' | 'rag' | null
  token_count: number
  conversation_id?: string | null
  created_at: string
}
```

- [ ] **Step 2: Add useConversationDocs and useLibraryDocs hooks**

Replace `promptbase/frontend/src/hooks/useDocumentStatus.ts`:

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

export function useLibraryDocs(teamId: string) {
  return useQuery<Document[]>({
    queryKey: ['library-docs', teamId],
    queryFn: async () => {
      const res = await api.get(`/documents/${teamId}/library`)
      return res.data.documents
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
git add promptbase/frontend/src/types/index.ts promptbase/frontend/src/hooks/useDocumentStatus.ts
git commit -m "feat: add document hooks for library and conversation docs"
```

---

### Task 4: Frontend — AttachButton component

**Files:**
- Create: `promptbase/frontend/src/components/AttachButton.tsx`

- [ ] **Step 1: Create AttachButton component**

```tsx
import { useState, useRef } from 'react'
import { Paperclip, Upload, Library, Loader2, FileText } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLibraryDocs } from '../hooks/useDocumentStatus'
import type { Document } from '../types'

interface Props {
  teamId: string
  conversationId: string | null
  onFileQueued: (file: File) => void
  onDocAttached: (doc: Document) => void
  disabled: boolean
}

export default function AttachButton({ teamId, conversationId, onFileQueued, onDocAttached, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { data: libraryDocs = [] } = useLibraryDocs(teamId)

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setOpen(false)

    if (!conversationId) {
      // Queue files for upload after conversation is created
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
          `/documents/${teamId}/upload?conversation_id=${conversationId}`,
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
    if (!conversationId) return
    setOpen(false)
    setShowLibrary(false)
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
        className="flex-shrink-0 w-10 h-10 text-gray-500 hover:text-gray-300 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
        title="Attach document"
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
      </button>

      {open && (
        <div className="absolute bottom-12 left-0 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
          {!showLibrary ? (
            <>
              <button
                onClick={() => { fileInputRef.current?.click(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <Upload size={14} />
                Upload file
              </button>
              {conversationId && (
                <button
                  onClick={() => setShowLibrary(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors border-t border-gray-700"
                >
                  <Library size={14} />
                  From library
                </button>
              )}
            </>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              <button
                onClick={() => setShowLibrary(false)}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-700 border-b border-gray-700"
              >
                ← Back
              </button>
              {libraryDocs.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500">No library documents</p>
              ) : (
                libraryDocs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleAttachFromLibrary(doc)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                  >
                    <FileText size={12} className="text-gray-500 shrink-0" />
                    <span className="truncate">{doc.filename}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/AttachButton.tsx
git commit -m "feat: add AttachButton component with upload and library dropdown"
```

---

### Task 5: Frontend — AttachedDocs component

**Files:**
- Create: `promptbase/frontend/src/components/AttachedDocs.tsx`

- [ ] **Step 1: Create AttachedDocs component**

```tsx
import { X, Loader2, CheckCircle2, FileText } from 'lucide-react'
import type { Document } from '../types'

interface AttachedDoc {
  id: string
  filename: string
  status: string
  isLibrary: boolean
}

interface Props {
  docs: AttachedDoc[]
  queuedFiles: File[]
  onRemove: (docId: string, isLibrary: boolean) => void
  onRemoveQueued: (index: number) => void
}

export default function AttachedDocs({ docs, queuedFiles, onRemove, onRemoveQueued }: Props) {
  if (docs.length === 0 && queuedFiles.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-2">
      {queuedFiles.map((file, idx) => (
        <span
          key={`queued-${idx}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-400"
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate max-w-[120px]">{file.name}</span>
          <Loader2 size={10} className="animate-spin text-yellow-400 shrink-0" />
          <button
            type="button"
            onClick={() => onRemoveQueued(idx)}
            className="text-gray-600 hover:text-red-400 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {docs.map((doc) => (
        <span
          key={doc.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-400"
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate max-w-[120px]">{doc.filename}</span>
          {doc.status === 'ready' ? (
            <CheckCircle2 size={10} className="text-green-400 shrink-0" />
          ) : (
            <Loader2 size={10} className="animate-spin text-blue-400 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => onRemove(doc.id, doc.isLibrary)}
            className="text-gray-600 hover:text-red-400 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/AttachedDocs.tsx
git commit -m "feat: add AttachedDocs pill display component"
```

---

### Task 6: Frontend — Update ChatInput with attach functionality

**Files:**
- Modify: `promptbase/frontend/src/components/ChatInput.tsx`

- [ ] **Step 1: Replace ChatInput.tsx**

```tsx
import { useState, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useConversationDocs } from '../hooks/useDocumentStatus'
import TaskForm from './TaskForm'
import AttachButton from './AttachButton'
import AttachedDocs from './AttachedDocs'
import type { TaskMode, Document } from '../types'

interface Props {
  onSend: (message: string, formData?: Record<string, string>, docIds?: string[]) => void
  onCancel: () => void
  isStreaming: boolean
  activeMode: TaskMode | null
  teamId: string
  conversationId: string | null
  onUploadQueued: (files: File[]) => void
}

export default function ChatInput({ onSend, onCancel, isStreaming, activeMode, teamId, conversationId, onUploadQueued }: Props) {
  const [text, setText] = useState('')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [attachedDocs, setAttachedDocs] = useState<Document[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { data: conversationDocs = [] } = useConversationDocs(conversationId)

  // Sync attached docs from server
  useEffect(() => {
    if (conversationDocs.length > 0) {
      setAttachedDocs(conversationDocs)
    }
  }, [conversationDocs])

  // Clear queued files when conversation changes
  useEffect(() => {
    setQueuedFiles([])
    setAttachedDocs([])
  }, [conversationId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (!message && !activeMode?.form_schema) return

    const docIds = attachedDocs.filter((d) => d.status === 'ready').map((d) => d.id)

    // If there are queued files, pass them up for upload after conversation creation
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
      await api.delete(`/documents/${teamId}/${docId}`)
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
    isLibrary: !d.conversation_id,
  }))

  return (
    <div className="border-t border-gray-800 bg-gray-950 p-4">
      {activeMode?.form_schema && (
        <div className="mb-3">
          <TaskForm schema={activeMode.form_schema} values={formData} onChange={setFormData} />
        </div>
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
          className="flex-1 resize-none bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-48 overflow-y-auto"
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
      <p className="text-xs text-gray-600 mt-2 text-center">Enter to send · Shift+Enter for newline</p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add promptbase/frontend/src/components/ChatInput.tsx
git commit -m "feat: integrate AttachButton and AttachedDocs into ChatInput"
```

---

### Task 7: Frontend — Update ChatMain, ChatPage, ChatSidebar

**Files:**
- Modify: `promptbase/frontend/src/components/ChatMain.tsx`
- Modify: `promptbase/frontend/src/pages/ChatPage.tsx`
- Modify: `promptbase/frontend/src/components/ChatSidebar.tsx`

- [ ] **Step 1: Update ChatMain — remove selectedDocIds, add upload queue handling, pass new props to ChatInput**

In `promptbase/frontend/src/components/ChatMain.tsx`:

Remove `selectedDocIds` from the Props interface and destructured params. Add `queuedFiles` state and upload handling. Update `handleSend` to accept `docIds`, and update `ChatInput` props.

Replace the Props interface:

```typescript
interface Props {
  team: Team
  conversation: Conversation | null
  onConversationCreated: (conv: Conversation) => void
  activeMode: TaskMode | null
}
```

Remove `selectedDocIds` from the component params:

```typescript
export default function ChatMain({ team, conversation, onConversationCreated, activeMode }: Props) {
```

Add state for queued files after the existing state declarations:

```typescript
const [pendingFiles, setPendingFiles] = useState<File[]>([])
```

Add the `api` import at the top (already imported) and `useQueryClient` (already imported).

Update `handleSend` to accept optional `docIds`:

```typescript
const handleSend = async (text: string, formData?: Record<string, string>, docIds?: string[]) => {
```

Replace the `document_ids: selectedDocIds` in the `startStream` call with `document_ids: docIds ?? []`.

Add upload of queued files in the `onMeta` callback, after the conversation is created:

```typescript
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
    // Upload queued files now that conversation exists
    if (pendingFiles.length > 0) {
      for (const file of pendingFiles) {
        const form = new FormData()
        form.append('file', file)
        api.post(`/documents/${team.id}/upload?conversation_id=${meta.conversation_id}`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      setPendingFiles([])
    }
  }
},
```

Update the `ChatInput` component in the JSX to pass new props:

```tsx
<ChatInput
  onSend={handleSend}
  onCancel={cancel}
  isStreaming={isStreaming}
  activeMode={activeMode}
  teamId={team.id}
  conversationId={conversationId}
  onUploadQueued={(files) => setPendingFiles(files)}
/>
```

- [ ] **Step 2: Update ChatPage — remove selectedDocIds and document props**

Replace `promptbase/frontend/src/pages/ChatPage.tsx`:

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Team, Conversation, TaskMode } from '../types'
import ChatSidebar from '../components/ChatSidebar'
import ChatMain from '../components/ChatMain'

export default function ChatPage() {
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeMode, setActiveMode] = useState<TaskMode | null>(null)

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      const data = res.data
      if (data.length > 0 && !activeTeam) setActiveTeam(data[0])
      return data
    },
  })

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <ChatSidebar
        teams={teams}
        activeTeam={activeTeam}
        onSelectTeam={(team) => {
          setActiveTeam(team)
          setActiveConversation(null)
          setActiveMode(null)
        }}
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
        onNewConversation={() => {
          setActiveConversation(null)
          setActiveMode(null)
        }}
        onModeChange={setActiveMode}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {activeTeam ? (
          <ChatMain
            team={activeTeam}
            conversation={activeConversation}
            onConversationCreated={setActiveConversation}
            activeMode={activeMode}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Select or create a team to start chatting.</p>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Update ChatSidebar — remove DocumentUpload**

Replace `promptbase/frontend/src/components/ChatSidebar.tsx`:

```tsx
import { PlusCircle, LogOut, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Team, Conversation, TaskMode } from '../types'
import ConversationList from './ConversationList'
import ModeSelector from './ModeSelector'

interface Props {
  teams: Team[]
  activeTeam: Team | null
  onSelectTeam: (team: Team) => void
  activeConversation: Conversation | null
  onSelectConversation: (conv: Conversation) => void
  onNewConversation: () => void
  onModeChange: (mode: TaskMode | null) => void
}

export default function ChatSidebar({
  teams, activeTeam, onSelectTeam,
  activeConversation, onSelectConversation, onNewConversation,
  onModeChange,
}: Props) {
  const { user, logout } = useAuth()

  return (
    <aside className="w-72 flex flex-col bg-gray-900 border-r border-gray-800 shrink-0">
      {/* Team selector */}
      <div className="p-4 border-b border-gray-800">
        <select
          value={activeTeam?.id ?? ''}
          onChange={(e) => {
            const team = teams.find((t) => t.id === e.target.value)
            if (team) onSelectTeam(team)
          }}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* New chat button */}
      <div className="p-3 border-b border-gray-800">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
        >
          <PlusCircle size={16} />
          New Chat
        </button>
      </div>

      {/* Mode selector */}
      {activeTeam && (
        <div className="px-3 py-2 border-b border-gray-800">
          <ModeSelector teamId={activeTeam.id} onModeChange={onModeChange} />
        </div>
      )}

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto">
        {activeTeam && (
          <ConversationList
            teamId={activeTeam.id}
            activeId={activeConversation?.id ?? null}
            onSelect={onSelectConversation}
          />
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-400 truncate">{user?.name}</span>
        <div className="flex gap-2">
          {user?.is_super_admin && (
            <Link to="/admin" className="p-1.5 text-gray-400 hover:text-white rounded transition-colors" title="Admin">
              <Settings size={16} />
            </Link>
          )}
          <button onClick={logout} className="p-1.5 text-gray-400 hover:text-white rounded transition-colors" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add promptbase/frontend/src/components/ChatMain.tsx promptbase/frontend/src/pages/ChatPage.tsx promptbase/frontend/src/components/ChatSidebar.tsx
git commit -m "feat: remove sidebar documents, wire up per-conversation docs in ChatMain"
```

---

### Task 8: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Run backend tests**

Run: `cd promptbase/backend && python3 -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Build frontend**

Run: `cd promptbase/frontend && npm run build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 3: Run migration**

Run: `cd promptbase && docker compose exec api alembic upgrade head`
Expected: Migration applies cleanly

- [ ] **Step 4: Manual smoke test**

1. Verify sidebar no longer shows document upload section
2. Verify paperclip button appears on chat input
3. Click paperclip → "Upload file" → upload a file in an existing conversation → verify pill appears
4. Click paperclip → "From library" → verify team-level docs show → attach one → verify pill
5. Click X on attached doc → verify it detaches
6. Start new conversation → attach file before first message → send message → verify file uploads after conversation creation
7. Reload conversation → verify attached docs show as pills

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: per-conversation documents with inline attach - complete"
```

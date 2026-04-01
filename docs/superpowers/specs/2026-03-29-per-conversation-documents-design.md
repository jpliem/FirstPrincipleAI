# Per-Conversation Documents

**Date:** 2026-03-29
**Status:** Approved

## Overview

Change document scoping from team-level to per-conversation. Documents are uploaded via a paperclip button on the chat input bar and scoped to the active conversation. A team library of shared documents remains accessible via an "attach from library" option.

## Design Decisions

- **Per-conversation with team library:** Documents uploaded in a conversation belong to that conversation. Team-level docs (library) can be attached to any conversation.
- **Inline attach UI:** Paperclip button on chat input bar with dropdown (upload new / pick from library). No sidebar document section.
- **Pre-first-message attach:** Users can attach documents before the first message. Files are held in frontend state and uploaded after the conversation is created on first send.

## Architecture

### Data Model Changes

**Document model** — add nullable `conversation_id` column:
```python
conversation_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=True
)
```

- `conversation_id = NULL` → team library document (shared, available to attach to any conversation)
- `conversation_id = <uuid>` → per-conversation document (only visible in that conversation)

**ConversationDocument junction table** — kept as-is. Used when a library doc is attached to a conversation. Per-conversation docs (with `conversation_id` set) don't need a junction row.

### API Changes

**Modified endpoint:**
- `POST /api/documents/{team_id}/upload` — add optional `conversation_id` query param. If provided, sets `Document.conversation_id`.

**New endpoints:**
- `GET /api/documents/{team_id}/library` — returns team-level docs where `conversation_id IS NULL` and `status = 'ready'`. Used by the "from library" dropdown.
- `GET /api/documents/conversation/{conversation_id}` — returns all documents for a conversation: both docs with `conversation_id = <id>` and docs linked via `ConversationDocument`. Used to populate the attached docs pills on conversation load.
- `POST /api/documents/conversation/{conversation_id}/attach` — attach a library doc to a conversation by creating a `ConversationDocument` row. Body: `{ "document_id": "<uuid>" }`.
- `DELETE /api/documents/conversation/{conversation_id}/detach/{document_id}` — remove a library doc from a conversation by deleting the `ConversationDocument` row. Only works for library docs (not per-conversation uploads).

### Frontend Changes

**Remove:**
- `DocumentUpload` component from the sidebar
- `selectedDocIds` state from `ChatPage` (no longer needed at page level)
- Document-related props passed from `ChatPage` to `ChatMain`

**New components:**

**`AttachButton`** — paperclip icon button on the chat input bar. Click opens a dropdown with:
- "Upload file" — opens file picker, uploads to current conversation (or queues if no conversation yet)
- "From library" — fetches `GET /api/documents/{team_id}/library`, shows list of ready team docs to attach

**`AttachedDocs`** — horizontal row of small pills above the chat input, one per attached document. Each pill shows:
- Filename (truncated)
- Status indicator: spinner (processing), checkmark (ready), X button to remove/detach
- Clicking X on a per-conversation doc deletes it; clicking X on a library doc detaches it

**ChatInput changes:**
- Add `AttachButton` to the left of the input area
- Add `AttachedDocs` above the input area
- Manage `attachedDocIds` state locally
- Pass doc IDs to the stream request

**ChatMain changes:**
- On conversation load, fetch `GET /api/documents/conversation/{conversation_id}` to populate attached docs
- Remove `selectedDocIds` prop (docs managed at input level now)

### Upload Flow

**Existing conversation:**
1. User clicks paperclip → "Upload file"
2. File picker opens, user selects file
3. Frontend calls `POST /api/documents/{team_id}/upload?conversation_id={id}`
4. Backend creates Document with `conversation_id`, kicks off processing
5. Pill appears with spinner, transitions to checkmark when ready
6. On next message send, doc ID included in `document_ids`

**New conversation (no ID yet):**
1. User clicks paperclip → "Upload file"
2. File is held in frontend state (not uploaded yet)
3. User types message and sends
4. `onMeta` callback returns `conversation_id` from first message
5. Frontend uploads queued files with the new `conversation_id`
6. Subsequent messages include the doc IDs once processing completes

**Attach from library:**
1. User clicks paperclip → "From library"
2. Dropdown shows team-level docs (ready status)
3. User clicks a doc → `POST /api/documents/conversation/{id}/attach`
4. Pill appears immediately (doc already ready)

### Sidebar Changes

Remove `DocumentUpload` from the sidebar. The sidebar retains:
- Conversation list
- Mode selector
- Any other existing sidebar content

### Migration

- Add `conversation_id` column to `documents` table (nullable FK)
- Existing documents remain with `conversation_id = NULL` (they become team library docs)
- FK should `ON DELETE CASCADE` — deleting a conversation deletes its per-conversation documents
- Library docs (conversation_id NULL) are never cascade-deleted

## Files Changed

| File | Change |
|------|--------|
| `backend/app/documents/models.py` | Add `conversation_id` FK to Document |
| `backend/app/documents/routes.py` | Add `conversation_id` param to upload, add library/conversation/attach/detach endpoints |
| `backend/app/chat/models.py` | No change (ConversationDocument stays) |
| `backend/alembic/versions/xxxx_add_conversation_id_to_documents.py` | Migration |
| `frontend/src/components/ChatInput.tsx` | Add AttachButton, AttachedDocs, manage doc state |
| `frontend/src/components/AttachButton.tsx` | New: paperclip dropdown with upload + library |
| `frontend/src/components/AttachedDocs.tsx` | New: pill display for attached documents |
| `frontend/src/components/ChatMain.tsx` | Fetch conversation docs on load, remove selectedDocIds prop |
| `frontend/src/components/ChatPage.tsx` | Remove DocumentUpload, selectedDocIds state |
| `frontend/src/components/ChatSidebar.tsx` | Remove document section if present |

## Out of Scope

- Drag-and-drop file upload (future enhancement)
- Document previews in the attach dropdown
- Bulk document operations
- Document sharing between conversations (copy)

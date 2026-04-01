# PromptBase UX Improvements Spec

**Date:** 2026-04-01
**Scope:** Conversation search, copy message, mode discoverability, error handling, typing indicator, password reset, conversation rename/pin/auto-name, personal documents

---

## 1. Backend Changes

### 1.1 Database Migration

**Conversation model additions:**
- `is_pinned: Boolean, default=False, nullable=False`

**Document model change:**
- `team_id`: change from `NOT NULL` to `NULLABLE`

Single Alembic migration covering both changes.

### 1.2 Conversation Management Endpoints

**PATCH `/api/chat/conversations/{conversation_id}`**
- Auth: owner only
- Body: `{ title?: str, is_pinned?: bool }`
- Updates provided fields, returns updated conversation
- Title max 500 chars

**GET `/api/chat/conversations/{team_id}?q=<term>`**
- Adds optional `q` query param
- Filters: `Conversation.title.ilike(f"%{q}%")`
- Pinned conversations sort first (`ORDER BY is_pinned DESC, updated_at DESC`)

**GET `/api/chat/conversations/personal?q=<term>`**
- Same `q` param and pinned-first sort as above

### 1.3 Conversation Auto-Naming

After the first assistant response finishes streaming in `stream_chat_response`:
1. Check if this is the first exchange (conversation has exactly 2 messages: user + assistant)
2. Fire a lightweight LLM call to the same provider/model:
   - Prompt: `"Summarize this conversation in 5-8 words as a title. Reply with only the title, no quotes."`
   - Input: user message + first 200 chars of assistant response
   - Max tokens: 20
3. Update `conversation.title` in DB
4. Include `new_title` field in the SSE `[DONE]` event payload

If the title generation fails, keep the existing first-60-chars title. No retry.

### 1.4 Password Reset (Admin-Only)

**POST `/api/admin/users/{user_id}/reset-password`**
- Auth: super_admin only
- Body: `{ new_password: str }` (min 8 chars)
- Hashes with bcrypt, updates `user.password_hash`
- Returns `{ success: true }`

### 1.5 Personal Document Endpoints

New endpoints mirroring team document routes, scoped to user instead of team:

| Endpoint | Description |
|----------|-------------|
| `POST /api/documents/personal/upload?conversation_id=...` | Upload file for personal use |
| `GET /api/documents/personal` | List user's personal documents |
| `GET /api/documents/personal/library` | Personal library docs (no conversation_id) |
| `DELETE /api/documents/personal/{document_id}` | Delete personal document (owner only) |

Storage path: `{upload_dir}/personal/{user_id}/{uuid}_{filename}`

Document processing uses the same Celery task. Embedding model falls back to env-configured default (no team LLM config available).

---

## 2. Frontend Changes

### 2.1 Conversation Search

**Location:** Top of ConversationList component

- Search input with `Search` (magnifying glass) icon from lucide-react
- Debounced at 300ms — passes `q` param to conversation list API call
- Empty search returns full list
- Pinned conversations always appear above non-pinned, separated by subtle divider line

### 2.2 Conversation Rename, Pin

**Inline rename:**
- Double-click on conversation title in sidebar triggers inline edit mode
- Renders an `<input>` replacing the title text
- Enter saves (calls PATCH endpoint), Escape cancels
- Shows brief loading state on save

**Context menu (right-click):**
- Options: Rename, Pin/Unpin, Delete
- Styled as a small floating menu with dark mode support
- Pin icon (lucide `Pin`) shown on pinned conversations in the list

**Sort order:** Pinned first, then by `updated_at` descending.

### 2.3 Conversation Auto-Name

- When SSE `[DONE]` event includes `new_title`, update the conversation object in React Query cache
- Also update the header title in ChatMain
- CSS fade transition on title change (0.3s opacity)

### 2.4 Copy Message to Clipboard

- Clipboard icon button (lucide `Copy`) appears on hover on ALL messages (user and assistant)
- Positioned inline with existing ExportButton for assistant messages
- Copies raw markdown `message.content` via `navigator.clipboard.writeText()`
- On click: icon briefly changes to `Check` icon for 2 seconds, then reverts

### 2.5 Mode Discoverability

**Remove:** ModeSelector dropdown from ChatSidebar.

**Add:** Mode chips row in ChatInput area, above the textarea. Only visible when:
- Team is selected AND
- Not in basic mode AND
- Modes are available for the team's pack

**Chip behavior:**
- Small pills rendered horizontally, wrapping if needed
- Click to select (indigo background), click again to deselect (back to auto-detect)
- Hover shows tooltip with first 100 chars of `mode.prompt_text`
- When `lastMeta.mode_detected` is set during streaming, the matching chip gets an indigo ring highlight
- Chips fetch modes from `/admin/packs/{packId}/modes` (same query as current ModeSelector)

### 2.6 Error Handling

**Remove:** Fake error message injection into message list.

**Add:** Dismissible error banner above chat input area.

- Red-tinted banner with error icon, error text, Retry button, and X close button
- Retry re-invokes `handleSend` with the last message/formData/docIds (store these in a ref)
- Auto-dismiss after 10 seconds
- Only one error banner visible at a time (new error replaces old)

**State:** `lastError: string | null` and `lastSendArgs` ref in ChatMain.

### 2.7 Typing/Loading Indicator

- Between message send and first token/thinking arrival: show a pulsing dots indicator
- Rendered as a ChatMessage-like bubble with three animated dots
- CSS animation: three circles with staggered `animation-delay` (0s, 0.2s, 0.4s), `pulse` keyframe
- Appears immediately on send, disappears when `streamBuffer` or `thinkingBuffer` becomes non-empty
- Uses `isStreaming && !streamBuffer && !thinkingBuffer` as the condition

### 2.8 Password Reset (Admin)

- "Reset Password" button on each user row in AdminUsers
- Opens a small modal with:
  - Password input (type=password, min 8 chars)
  - Confirm password input
  - Client-side validation: passwords must match, min 8 chars
  - Submit button calls `POST /api/admin/users/{user_id}/reset-password`
  - Success: close modal, show brief success toast/message
  - Error: show inline error in modal

### 2.9 Personal Documents

- Show `AttachButton` in ChatInput when `teamId` is null (currently hidden)
- AttachButton routes to `/documents/personal/upload` instead of `/documents/{teamId}/upload`
- Document library queries use `/documents/personal/library` when no team
- Same upload UX: drag-and-drop, progress indicator, status pills

---

## 3. Migration Plan

Single Alembic migration:
```
f6a7b8c9d0e1_conversation_pin_and_nullable_doc_team.py
```

Operations:
1. `ALTER TABLE conversations ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE`
2. `ALTER TABLE documents ALTER COLUMN team_id DROP NOT NULL`
3. Create index: `ix_conversations_pinned_updated` on `(is_pinned DESC, updated_at DESC)`

---

## 4. Files to Create/Modify

### Backend
| File | Action |
|------|--------|
| `alembic/versions/f6a7b8c9d0e1_...py` | Create — migration |
| `app/chat/models.py` | Modify — add `is_pinned` to Conversation |
| `app/chat/schemas.py` | Modify — add `ConversationUpdate` schema, add `is_pinned`/`new_title` to responses |
| `app/chat/routes.py` | Modify — add PATCH endpoint, add `q` param to list endpoints, pinned-first sort |
| `app/chat/service.py` | Modify — add auto-naming after first exchange in stream flow |
| `app/documents/models.py` | Modify — make `team_id` nullable |
| `app/documents/routes.py` | Modify — add personal document endpoints |
| `app/documents/schemas.py` | Modify — make `team_id` optional in response |
| `app/auth/routes.py` | Modify — add password reset endpoint (or in admin routes) |
| `app/admin/routes.py` | Modify — add password reset endpoint |

### Frontend
| File | Action |
|------|--------|
| `src/types/index.ts` | Modify — add `is_pinned` to Conversation, `new_title` to done event |
| `src/components/ConversationList.tsx` | Modify — add search input, pinned section, inline rename, context menu |
| `src/components/ChatMain.tsx` | Modify — error banner, typing indicator, auto-name update, store last send args |
| `src/components/ChatInput.tsx` | Modify — mode chips, personal document support |
| `src/components/ChatMessage.tsx` | Modify — add copy button on hover |
| `src/components/ChatSidebar.tsx` | Modify — remove ModeSelector |
| `src/components/ModeChips.tsx` | Create — mode chips component |
| `src/components/TypingIndicator.tsx` | Create — pulsing dots component |
| `src/components/ErrorBanner.tsx` | Create — dismissible error banner |
| `src/components/ContextMenu.tsx` | Create — right-click context menu |
| `src/components/ResetPasswordModal.tsx` | Create — admin password reset modal |
| `src/pages/admin/AdminUsers.tsx` | Modify — add reset password button + modal |
| `src/hooks/useSSE.ts` | Modify — parse `new_title` from done event |
| `src/index.css` | Modify — add typing indicator keyframes |

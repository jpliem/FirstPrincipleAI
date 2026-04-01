# Prompt Pack Expander

**Date:** 2026-03-29
**Status:** Approved

## Overview

A chat-based interview system in the Admin Packs page where an LLM dynamically asks the admin questions about their organization, then generates prompt pack modules based on the answers. Works for creating new packs from scratch or expanding existing packs. Never edits the original — always creates a duplicate (fork).

## Design Decisions

- **Admin only** — accessible from the Admin Packs page, not from the chat interface
- **Dynamic interview** — LLM generates context-aware questions based on current pack state and conversation history, not a fixed questionnaire
- **Both modes** — create from scratch (blank start) or expand existing pack (LLM reads current modules, identifies gaps)
- **Fork, never edit** — changes always create a new pack, original is untouched
- **Diff review** — admin sees proposed modules with accept/reject per module before creation
- **Admin-controlled pacing** — LLM keeps asking questions until admin clicks "Generate Pack" button; admin can stop early or answer extensively

## Architecture

### Interview Flow

1. Admin clicks "Create New Pack" (from scratch) or "Expand Pack" on an existing pack
2. A chat modal opens
3. **From scratch:** LLM starts with broad organizational questions — dynamically generated based on what it learns
4. **From existing:** LLM receives all current module contents as context, then asks targeted gap-filling questions ("I see IoT modules but nothing about security — do your teams handle security?")
5. Admin answers naturally. Can also give direct instructions ("add a module about MQTT protocols")
6. A **"Generate Pack"** button is always visible during the interview
7. Admin clicks "Generate Pack" when ready — LLM stops interviewing and generates modules

### Generation + Diff Review

After the admin clicks "Generate Pack":

1. LLM generates a structured JSON response containing proposed modules (title, layer, tags, priority, sort_order, content)
2. **For new packs:** admin sees a list of proposed modules with title, layer, content preview, and accept/reject toggle per module
3. **For expansions:** admin sees a diff — new modules, modified modules (old vs new side-by-side), unchanged modules grayed out — with accept/reject per change
4. Admin confirms selection
5. A new `PromptPack` is created with the accepted modules
6. Original pack (if expanding) is untouched

### Pack Deletion

- Delete button on each pack in the admin list
- If pack is assigned to a team, show a warning: "This pack is assigned to [team name]. Deleting it will leave the team without a pack."
- Confirm dialog before deletion
- Cascade deletes modules and modes belonging to the pack

### Backend

**Interview session management:**

The interview is stateless from the backend perspective — the frontend sends the full conversation history with each request, same as regular chat. No session table needed.

**System prompt for interview mode:**

The LLM receives a special system prompt that instructs it to:
- Act as a prompt engineering expert
- Ask one question at a time about the organization
- Build understanding of domains, workflows, roles, delivery processes
- When source pack modules are provided, identify gaps and suggest improvements
- Never generate modules during the interview — only ask questions

**System prompt for generation mode:**

When the admin clicks "Generate Pack," the LLM receives a different system prompt:
- All interview conversation history as context
- Source pack modules (if expanding)
- Instructions to generate a JSON array of modules with fields: `title`, `layer`, `tags`, `priority`, `sort_order`, `content`
- Each module's content should be markdown — the actual instruction text for the system prompt

**New endpoints:**

- `POST /api/admin/pack-builder/chat` — send admin message + conversation history + optional source_pack_id. Returns LLM's next question. Uses the interview system prompt.

- `POST /api/admin/pack-builder/generate` — send conversation history + optional source_pack_id. Returns proposed modules as JSON. Uses the generation system prompt. Response format:
  ```json
  {
    "pack_name": "Generated Pack Name",
    "modules": [
      {
        "title": "Module Title",
        "layer": "core",
        "tags": ["tag1", "tag2"],
        "priority": 100,
        "sort_order": 0,
        "content": "# Module content in markdown..."
      }
    ]
  }
  ```

- `POST /api/admin/pack-builder/apply` — accepts `pack_name`, list of accepted module indices, optional `source_pack_id`. Creates a new `PromptPack` and `PromptModule` records. If expanding, also copies over any unchanged modules the admin didn't reject. Body:
  ```json
  {
    "pack_name": "My Pack v2",
    "source_pack_id": "uuid-or-null",
    "accepted_modules": [0, 1, 3, 5],
    "generated_modules": [... full module array from generate response ...]
  }
  ```

- `DELETE /api/admin/packs/{pack_id}` — delete a pack. Returns 409 if assigned to a team (with team name in error), or deletes with cascade if unassigned or force=true query param.

**LLM provider:** Uses the same provider/model configured for the admin's team (or fallback chain from `_load_llm_config`). The pack builder endpoints need a `team_id` parameter to resolve the LLM config.

### Frontend

**AdminPacks page changes:**
- Add "Create New Pack" button at the top of the pack list
- Add "Expand" button per pack row (next to existing edit/export buttons)
- Add "Delete" button per pack row with confirmation dialog
- Both "Create" and "Expand" open the `PackBuilderModal`

**PackBuilderModal** (new component):
- Full-screen or large modal with chat interface
- Left side: chat messages (reuse `ChatMessage` component for rendering)
- Chat input at the bottom for admin responses
- **"Generate Pack" button** — always visible, prominent (e.g., fixed in header or floating)
- After generation: switches to a review view showing proposed modules
- Review view: list of modules with title, layer, tags, content preview (expandable), and accept/reject checkbox per module
- For expansions: shows diff indicators (new/modified/unchanged)
- "Create Pack" button to finalize and create the pack from accepted modules
- Pack name input field (pre-filled with "[Source Name] (expanded)" or "New Pack")

**Streaming:** The interview chat and generation both use SSE streaming, same as the main chat. The generation response streams the JSON — frontend parses it after stream completes.

## Files Changed

| File | Change |
|------|--------|
| `backend/app/admin/pack_builder.py` | **Create:** New router with chat, generate, apply endpoints |
| `backend/app/admin/routes.py` | **Modify:** Add delete pack endpoint, include pack_builder router |
| `backend/app/main.py` | **Modify:** Register pack_builder router if not auto-included |
| `frontend/src/pages/admin/AdminPacks.tsx` | **Modify:** Add Create/Expand/Delete buttons |
| `frontend/src/components/PackBuilderModal.tsx` | **Create:** Interview chat + review interface |
| `frontend/src/components/ModuleReview.tsx` | **Create:** Module list with accept/reject toggles and diff view |

## Out of Scope

- Version history for packs (future)
- Collaborative editing (multiple admins)
- Auto-expanding based on chat usage patterns
- Module-level granular diff (word-level changes)
- Importing external docs as module seeds during interview

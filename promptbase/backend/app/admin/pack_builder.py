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
    messages: list[dict]
    source_pack_id: uuid.UUID | None = None


class BuilderGenerateRequest(BaseModel):
    messages: list[dict]
    source_pack_id: uuid.UUID | None = None
    pack_name: str = "Generated Pack"


class BuilderApplyRequest(BaseModel):
    pack_name: str
    source_pack_id: uuid.UUID | None = None
    accepted_indices: list[int]
    modules: list[dict]


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

Include ALL modules — both unchanged ones from the source and new/modified ones.

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
    config.max_tokens = 16384
    config.temperature = 0.5

    if body.source_pack_id:
        source_modules = await _load_source_modules(db, body.source_pack_id)
        system_prompt = GENERATE_WITH_SOURCE_PROMPT.format(source_modules=source_modules)
    else:
        system_prompt = GENERATE_SYSTEM_PROMPT

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

    pack = PromptPack(
        name=body.pack_name,
        version="1.0.0",
        description=f"Generated by Pack Builder{' (expanded)' if body.source_pack_id else ''}",
    )
    db.add(pack)
    await db.flush()

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

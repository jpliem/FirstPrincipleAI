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
    model: str | None = None


class BuilderGenerateRequest(BaseModel):
    messages: list[dict]
    source_pack_id: uuid.UUID | None = None
    pack_name: str = "Generated Pack"
    model: str | None = None


class BuilderApplyRequest(BaseModel):
    pack_name: str
    source_pack_id: uuid.UUID | None = None
    accepted_indices: list[int]
    modules: list[dict]


async def _get_llm(db: AsyncSession, model_override: str | None = None) -> tuple:
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

    if model_override:
        model = model_override
    elif prov.default_model:
        model = prov.default_model
    elif prov.name == "ollama":
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
        parts.append(f"### Module: {m.title}\n- Layer: {m.layer}\n- Tags: {json.dumps(m.tags or [])}\n- Priority: {m.priority}\n\n{m.content}")
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

You MUST read and reference the existing modules below carefully. Your questions should be specific to what you see — mention module names, point out specific gaps, reference actual content.

## Current Pack Modules

{source_modules}

## Your Job

Ask ONE question at a time. Each question must demonstrate you've read the modules:
- Reference specific modules by name ("I see your '06_DIGITAL_THREAD' module covers traceability, but it doesn't mention...")
- Identify concrete gaps ("You have IoT and business app domains but nothing about cybersecurity — is that intentional?")
- Suggest specific improvements ("The 'OUTPUT_FORMAT' module only specifies markdown — do you also need structured data output like JSON or CSV?")
- Ask about outdated content ("The 'PROJECT_OVERVIEW' references a specific organizational structure — has this changed?")

Do NOT ask broad generic questions like "what domains do you work in" — the modules already tell you that.
Do NOT generate modules or output JSON. Only ask targeted questions and acknowledge answers.

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

GENERATE_WITH_SOURCE_PROMPT = """You are a prompt engineering expert. Based on the interview conversation and the existing pack modules below, generate ONLY the new and modified modules.

Existing modules:
{source_modules}

IMPORTANT RULES:
- Do NOT re-emit modules that are unchanged. Only include modules you are adding or modifying.
- For modified modules, include the full updated content (not a diff).
- For new modules, assign sort_order values that place them logically (e.g. after existing modules, or between them).
- Keep module titles consistent with the existing pack's naming convention.

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

Guidelines for modules:
- **core** layer: Foundational instructions loaded for every request. Priority 100.
- **always** layer: Context always appended. Priority 90.
- **domain** layer: Topic-specific instructions. Priority 50. Tags should contain 5-10 trigger keywords.
- Each module's content should be detailed markdown.

Output ONLY valid JSON. No explanation before or after."""


@router.post("/chat")
async def builder_chat(
    body: BuilderChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    provider, config = await _get_llm(db, model_override=body.model)

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

    provider, config = await _get_llm(db, model_override=body.model)
    config.temperature = 0.5

    if body.source_pack_id:
        source_modules = await _load_source_modules(db, body.source_pack_id)
        system_prompt = GENERATE_WITH_SOURCE_PROMPT.format(source_modules=source_modules)
    else:
        system_prompt = GENERATE_SYSTEM_PROMPT

    messages = body.messages + [
        {"role": "user", "content": f"Based on our conversation, generate the prompt pack now. Name it '{body.pack_name}'."}
    ]

    # Dynamic max_tokens: fill remaining context window
    # For Ollama, fetch actual context size from the running model
    if hasattr(provider, "fetch_context_size"):
        context_limit = await provider.fetch_context_size(config.model, config.base_url)
        config.max_context = context_limit
    else:
        context_limit = provider.max_context_tokens(config.model)
    prompt_tokens = provider.count_tokens(system_prompt)
    for m in messages:
        prompt_tokens += provider.count_tokens(m.get("content", ""))
    config.max_tokens = max(4096, context_limit - prompt_tokens - 256)

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

    module_count = 0

    # If expanding, carry over source modules that aren't being replaced
    if body.source_pack_id:
        source_result = await db.execute(
            select(PromptModule).where(PromptModule.pack_id == body.source_pack_id).order_by(PromptModule.sort_order)
        )
        source_modules = source_result.scalars().all()

        # Collect titles of accepted new/modified modules
        new_titles = set()
        for idx in body.accepted_indices:
            if 0 <= idx < len(body.modules):
                new_titles.add(body.modules[idx].get("title", "").strip().lower())

        # Copy source modules that aren't replaced by new ones
        for sm in source_modules:
            if sm.title.strip().lower() not in new_titles:
                module = PromptModule(
                    pack_id=pack.id,
                    filename=sm.filename,
                    title=sm.title,
                    layer=sm.layer,
                    tags=sm.tags or [],
                    priority=sm.priority,
                    content=sm.content,
                    token_count=sm.token_count,
                    sort_order=sm.sort_order,
                )
                db.add(module)
                module_count += 1

    # Add accepted new/modified modules
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
        module_count += 1

    await db.commit()
    await db.refresh(pack)

    return {"id": str(pack.id), "name": pack.name, "module_count": module_count}

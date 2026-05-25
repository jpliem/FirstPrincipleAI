import io
import json
import uuid
import zipfile

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.importer import import_pack_from_zip
from app.auth.dependencies import get_current_user
from app.auth.models import InviteLink, Team, TeamMember, User
from app.auth.service import get_user_team_role
from app.compiler.budget import count_tokens_approx
from app.compiler.models import PromptModule, PromptPack, TaskMode
from app.compiler.schemas import (
    PromptModuleCreate,
    PromptModuleResponse,
    PromptPackCreate,
    PromptPackResponse,
    TaskModeCreate,
    TaskModeResponse,
)
from app.database import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/packs", response_model=list[PromptPackResponse])
async def list_packs(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func as sa_func
    result = await db.execute(
        select(
            PromptPack,
            sa_func.count(PromptModule.id).label("module_count"),
        )
        .outerjoin(PromptModule, PromptModule.pack_id == PromptPack.id)
        .group_by(PromptPack.id)
        .order_by(PromptPack.created_at.desc())
    )
    rows = result.all()
    return [
        PromptPackResponse(
            id=p.id, name=p.name, version=p.version, description=p.description,
            team_id=p.team_id, created_at=p.created_at.isoformat(),
            module_count=count,
        )
        for p, count in rows
    ]


@router.post("/packs", response_model=PromptPackResponse, status_code=status.HTTP_201_CREATED)
async def create_pack(
    body: PromptPackCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    pack = PromptPack(name=body.name, version=body.version, description=body.description)
    db.add(pack)
    await db.commit()
    await db.refresh(pack)
    return PromptPackResponse(
        id=pack.id, name=pack.name, version=pack.version,
        description=pack.description, team_id=pack.team_id, created_at=pack.created_at.isoformat(),
    )


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

    # Check if assigned to any teams
    team_result = await db.execute(select(Team).where(Team.pack_id == pack_id))
    assigned_teams = team_result.scalars().all()
    if assigned_teams and not force:
        names = ", ".join(t.name for t in assigned_teams)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pack is assigned to team(s): {names}. Use force=true to delete anyway.",
        )

    for t in assigned_teams:
        t.pack_id = None
    if assigned_teams:
        await db.flush()

    # Delete modes and modules
    modes = (await db.execute(select(TaskMode).where(TaskMode.pack_id == pack_id))).scalars().all()
    for mode in modes:
        await db.delete(mode)

    modules = (await db.execute(select(PromptModule).where(PromptModule.pack_id == pack_id))).scalars().all()
    for module in modules:
        await db.delete(module)

    await db.delete(pack)
    await db.commit()


@router.post("/packs/import")
async def import_pack(
    file: UploadFile, name: str = Form("Imported Pack"),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")
    contents = await file.read()
    pack = await import_pack_from_zip(db, contents, name)
    return {"id": str(pack.id), "name": pack.name, "version": pack.version}


@router.get("/packs/{pack_id}/export")
async def export_pack(
    pack_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    pack_result = await db.execute(select(PromptPack).where(PromptPack.id == pack_id))
    pack = pack_result.scalar_one_or_none()
    if not pack:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    modules_result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack_id).order_by(PromptModule.sort_order)
    )
    modules = modules_result.scalars().all()

    modes_result = await db.execute(select(TaskMode).where(TaskMode.pack_id == pack_id))
    modes = modes_result.scalars().all()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "version": pack.version, "description": pack.description,
            "core": [m.filename for m in modules if m.layer == "core"],
            "always_append": [m.filename for m in modules if m.layer == "always"],
            "domains": {},
            "modes": [{"name": m.name, "prompt_text": m.prompt_text, "form_schema": m.form_schema} for m in modes],
        }

        for m in modules:
            if m.layer == "domain":
                key = m.filename.replace(".md", "").lower()
                manifest["domains"][key] = [m.filename]

            frontmatter = f"---\ntitle: {m.title}\ntags: {json.dumps(m.tags or [])}\npriority: {m.priority}\nlayer: {m.layer}\n---\n\n"
            zf.writestr(f"prompts/{m.filename}", frontmatter + m.content)

        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    buffer.seek(0)
    return StreamingResponse(
        buffer, media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={pack.name}.zip"},
    )


@router.get("/packs/{pack_id}/modules", response_model=list[PromptModuleResponse])
async def list_modules(
    pack_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack_id).order_by(PromptModule.sort_order)
    )
    return result.scalars().all()


@router.post("/packs/{pack_id}/modules", response_model=PromptModuleResponse, status_code=status.HTTP_201_CREATED)
async def create_module(
    pack_id: uuid.UUID, body: PromptModuleCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    module = PromptModule(
        pack_id=pack_id, filename=body.filename, title=body.title, layer=body.layer,
        tags=body.tags, priority=body.priority, content=body.content,
        token_count=count_tokens_approx(body.content), max_tokens=body.max_tokens, sort_order=body.sort_order,
    )
    db.add(module)
    await db.commit()
    await db.refresh(module)
    return module


@router.put("/modules/{module_id}", response_model=PromptModuleResponse)
async def update_module(
    module_id: uuid.UUID, body: PromptModuleCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PromptModule).where(PromptModule.id == module_id))
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    module.filename = body.filename
    module.title = body.title
    module.layer = body.layer
    module.tags = body.tags
    module.priority = body.priority
    module.content = body.content
    module.token_count = count_tokens_approx(body.content)
    module.max_tokens = body.max_tokens
    module.sort_order = body.sort_order

    await db.commit()
    await db.refresh(module)
    return module


@router.delete("/modules/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_module(
    module_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PromptModule).where(PromptModule.id == module_id))
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await db.delete(module)
    await db.commit()


@router.get("/packs/{pack_id}/modes", response_model=list[TaskModeResponse])
async def list_modes(
    pack_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TaskMode).where(TaskMode.pack_id == pack_id).order_by(TaskMode.sort_order)
    )
    return result.scalars().all()


@router.post("/packs/{pack_id}/modes", response_model=TaskModeResponse, status_code=status.HTTP_201_CREATED)
async def create_mode(
    pack_id: uuid.UUID, body: TaskModeCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    mode = TaskMode(
        pack_id=pack_id, name=body.name, prompt_text=body.prompt_text,
        form_schema=body.form_schema, sort_order=body.sort_order,
    )
    db.add(mode)
    await db.commit()
    await db.refresh(mode)
    return mode


@router.put("/teams/{team_id}/pack")
async def assign_pack_to_team(
    team_id: uuid.UUID, pack_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role != "admin" and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    team.pack_id = pack_id
    await db.commit()
    return {"team_id": str(team_id), "pack_id": str(pack_id)}


# --- AI Pack Analyzer ---

@router.post("/packs/{pack_id}/analyze")
async def analyze_pack(
    pack_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Use AI to analyze each module and suggest layer, tags, priority, and description."""
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    from app.providers.models import LLMProviderConfig, TeamLLMConfig
    from app.providers.base import LLMConfig
    from app.providers.registry import get_provider

    # Find any configured provider to use for analysis
    providers_result = await db.execute(
        select(LLMProviderConfig).where(LLMProviderConfig.is_enabled == True)
    )
    providers_list = providers_result.scalars().all()
    if not providers_list:
        raise HTTPException(status_code=400, detail="No LLM provider configured. Add one in LLM Providers first.")

    # Use the first available provider
    prov = providers_list[0]
    provider = get_provider(prov.name)
    if not provider:
        raise HTTPException(status_code=400, detail=f"Provider '{prov.name}' not available")

    # Pick a model — for Ollama try to get one from tags, otherwise use a default
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

    llm_config = LLMConfig(
        model=model,
        api_key=prov.api_key_encrypted or "",
        base_url=prov.base_url or "",
        temperature=0.3,
        max_tokens=4096,
    )

    # Load pack modules
    modules_result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack_id).order_by(PromptModule.sort_order)
    )
    modules = modules_result.scalars().all()

    if not modules:
        raise HTTPException(status_code=404, detail="Pack has no modules")

    # Build analysis prompt
    modules_summary = []
    for m in modules:
        preview = m.content[:300].replace("\n", " ")
        modules_summary.append(f"- **{m.filename}** (current layer: {m.layer}, tags: {m.tags}): {preview}...")

    analysis_prompt = f"""Analyze this prompt pack with {len(modules)} modules. For each module, determine:

1. **layer**: Should it be "core" (always loaded for every request), "always" (always appended after core), or "domain" (only loaded when the topic matches)?
2. **tags**: If domain, what keywords should trigger loading this module? List 5-10 relevant keywords.
3. **priority**: 1-100 (100 = most important, loaded first when budget is tight)
4. **description**: One sentence describing what this module does.

Modules:
{chr(10).join(modules_summary)}

Respond in JSON format ONLY — no other text:
```json
[
  {{"filename": "...", "layer": "core|domain|always", "tags": ["keyword1", "keyword2"], "priority": 85, "description": "..."}}
]
```"""

    # Call LLM — use non-streaming for analysis to get complete response
    # For thinking models (qwen, deepseek), add /no_think instruction
    import httpx as _httpx

    base_url = (prov.base_url or "http://localhost:11434").rstrip("/")
    full_response = ""

    if prov.name == "ollama":
        # Direct Ollama API call (non-streaming) to avoid thinking token issues
        async with _httpx.AsyncClient(follow_redirects=True, timeout=_httpx.Timeout(10, read=120)) as hc:
            res = await hc.post(f"{base_url}/api/chat", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a prompt engineering analyst. Respond ONLY with valid JSON. No explanation, no markdown."},
                    {"role": "user", "content": "/no_think\n\n" + analysis_prompt},
                ],
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 4096},
            })
            if res.status_code == 200:
                data = res.json()
                full_response = data.get("message", {}).get("content", "")
            else:
                return {"error": f"Ollama returned {res.status_code}: {res.text[:500]}"}
    else:
        async for token in provider.stream_chat(
            "You are a prompt engineering analyst. Respond only with the requested JSON.",
            [{"role": "user", "content": analysis_prompt}],
            llm_config,
        ):
            full_response += token

    if not full_response.strip():
        return {"error": "AI returned empty response", "model": model}

    # Parse JSON from response
    try:
        # Extract JSON from possible markdown code blocks or thinking tags
        json_str = full_response
        # Strip <think>...</think> blocks
        import re
        json_str = re.sub(r'<think>.*?</think>', '', json_str, flags=re.DOTALL)
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]
        # Try to find JSON array
        json_str = json_str.strip()
        if not json_str.startswith("["):
            # Find first [
            idx = json_str.find("[")
            if idx >= 0:
                json_str = json_str[idx:]

        analysis = json.loads(json_str.strip())
    except (json.JSONDecodeError, IndexError) as e:
        return {"error": f"Failed to parse AI response: {e}", "raw_response": full_response[:2000]}

    # Build lookup by filename
    analysis_map = {item["filename"]: item for item in analysis if isinstance(item, dict)}

    results = []
    for m in modules:
        suggestion = analysis_map.get(m.filename, {})
        results.append({
            "module_id": str(m.id),
            "filename": m.filename,
            "current_layer": m.layer,
            "current_tags": m.tags,
            "current_priority": m.priority,
            "suggested_layer": suggestion.get("layer", m.layer),
            "suggested_tags": suggestion.get("tags", m.tags),
            "suggested_priority": suggestion.get("priority", m.priority),
            "suggested_description": suggestion.get("description", ""),
        })

    return {"pack_id": str(pack_id), "model_used": model, "analysis": results}


@router.post("/packs/{pack_id}/apply-analysis")
async def apply_analysis(
    pack_id: uuid.UUID,
    analysis: list[dict],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply AI analysis results to update module layers, tags, and priorities."""
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    updated = 0
    for item in analysis:
        module_id = item.get("module_id")
        if not module_id:
            continue
        result = await db.execute(select(PromptModule).where(PromptModule.id == uuid.UUID(module_id)))
        module = result.scalar_one_or_none()
        if not module or str(module.pack_id) != str(pack_id):
            continue

        if "suggested_layer" in item:
            module.layer = item["suggested_layer"]
        if "suggested_tags" in item:
            module.tags = item["suggested_tags"]
        if "suggested_priority" in item:
            module.priority = item["suggested_priority"]
        updated += 1

    await db.commit()
    return {"updated": updated}


# --- LLM Provider Config ---

from app.providers.models import LLMProviderConfig, TeamLLMConfig
from pydantic import BaseModel


class LLMProviderConfigCreate(BaseModel):
    name: str  # anthropic, openai, openrouter, ollama
    base_url: str | None = None
    api_key: str | None = None
    is_enabled: bool = True
    default_model: str | None = None


class LLMProviderConfigResponse(BaseModel):
    id: uuid.UUID
    name: str
    base_url: str | None
    has_api_key: bool
    is_enabled: bool
    default_model: str | None = None

    model_config = {"from_attributes": True}


class TeamLLMConfigCreate(BaseModel):
    provider_name: str
    chat_model: str
    embedding_model: str = "text-embedding-3-small"
    max_tokens_per_request: int = 4096
    temperature: float = 0.7


class TeamLLMConfigResponse(BaseModel):
    id: uuid.UUID
    team_id: uuid.UUID
    provider_name: str
    chat_model: str
    embedding_model: str
    max_tokens_per_request: int
    temperature: float

    model_config = {"from_attributes": True}


@router.get("/providers", response_model=list[LLMProviderConfigResponse])
async def list_providers(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    result = await db.execute(select(LLMProviderConfig))
    providers = result.scalars().all()
    return [
        LLMProviderConfigResponse(
            id=p.id, name=p.name, base_url=p.base_url,
            has_api_key=bool(p.api_key_encrypted), is_enabled=p.is_enabled,
            default_model=p.default_model,
        )
        for p in providers
    ]


@router.post("/providers", status_code=status.HTTP_201_CREATED)
async def create_or_update_provider(
    body: LLMProviderConfigCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(select(LLMProviderConfig).where(LLMProviderConfig.name == body.name))
    provider = result.scalar_one_or_none()

    if provider:
        provider.base_url = body.base_url
        if body.api_key:
            provider.api_key_encrypted = body.api_key  # TODO: encrypt in production
        provider.is_enabled = body.is_enabled
        provider.default_model = body.default_model
    else:
        provider = LLMProviderConfig(
            name=body.name,
            base_url=body.base_url,
            api_key_encrypted=body.api_key,  # TODO: encrypt in production
            is_enabled=body.is_enabled,
            default_model=body.default_model,
        )
        db.add(provider)

    await db.commit()
    await db.refresh(provider)
    return {"id": str(provider.id), "name": provider.name}


@router.put("/providers/{provider_id}")
async def update_provider(
    provider_id: uuid.UUID, body: LLMProviderConfigCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    result = await db.execute(select(LLMProviderConfig).where(LLMProviderConfig.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    provider.name = body.name
    provider.base_url = body.base_url
    if body.api_key:
        provider.api_key_encrypted = body.api_key
    provider.is_enabled = body.is_enabled
    provider.default_model = body.default_model
    await db.commit()
    await db.refresh(provider)
    return LLMProviderConfigResponse(
        id=provider.id, name=provider.name, base_url=provider.base_url,
        has_api_key=bool(provider.api_key_encrypted), is_enabled=provider.is_enabled,
        default_model=provider.default_model,
    )


@router.get("/providers/{provider_name}/models")
async def list_provider_models(
    provider_name: str,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Fetch available models from the provider's API."""
    import httpx

    result = await db.execute(select(LLMProviderConfig).where(LLMProviderConfig.name == provider_name))
    provider = result.scalar_one_or_none()

    api_key = provider.api_key_encrypted if provider else ""
    base_url = (provider.base_url or "").rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            if provider_name == "ollama":
                url = (base_url or "http://host.docker.internal:11434") + "/api/tags"
                res = await client.get(url)
                res.raise_for_status()
                data = res.json()
                models = [m["name"] for m in data.get("models", [])]
                return {"provider": provider_name, "models": models}

            elif provider_name == "openrouter":
                url = (base_url.rstrip("/") + "/api/v1/models") if base_url else "https://openrouter.ai/api/v1/models"
                res = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
                )
                res.raise_for_status()
                data = res.json()
                models = [m["id"] for m in data.get("data", [])]
                return {"provider": provider_name, "models": models[:100]}

            elif provider_name == "openai":
                url = (base_url.rstrip("/") + "/v1/models") if base_url else "https://api.openai.com/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                res = await client.get(url, headers=headers)
                res.raise_for_status()
                data = res.json()
                models = [m["id"] for m in data.get("data", [])]
                return {"provider": provider_name, "models": sorted(models)}

            elif provider_name == "anthropic":
                if base_url:
                    # Custom base URL — try OpenAI-compatible models endpoint
                    url = base_url.rstrip("/") + "/v1/models"
                    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                    res = await client.get(url, headers=headers)
                    res.raise_for_status()
                    data = res.json()
                    models = [m["id"] for m in data.get("data", [])]
                    return {"provider": provider_name, "models": sorted(models)}
                # No custom URL — return known Anthropic models
                return {"provider": provider_name, "models": [
                    "claude-opus-4-20250514",
                    "claude-sonnet-4-20250514",
                    "claude-haiku-4-20250414",
                ]}

            else:
                return {"provider": provider_name, "models": [], "error": f"Unknown provider: {provider_name}"}

    except httpx.HTTPError as e:
        return {"provider": provider_name, "models": [], "error": str(e)}
    except Exception as e:
        return {"provider": provider_name, "models": [], "error": str(e)}


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    result = await db.execute(select(LLMProviderConfig).where(LLMProviderConfig.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await db.delete(provider)
    await db.commit()


@router.get("/teams/{team_id}/llm-config", response_model=TeamLLMConfigResponse | None)
async def get_team_llm_config(
    team_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TeamLLMConfig).where(TeamLLMConfig.team_id == team_id))
    config = result.scalar_one_or_none()
    if not config:
        return None
    return config


@router.put("/teams/{team_id}/llm-config", response_model=TeamLLMConfigResponse)
async def set_team_llm_config(
    team_id: uuid.UUID, body: TeamLLMConfigCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role != "admin" and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(select(TeamLLMConfig).where(TeamLLMConfig.team_id == team_id))
    config = result.scalar_one_or_none()

    if config:
        config.provider_name = body.provider_name
        config.chat_model = body.chat_model
        config.embedding_model = body.embedding_model
        config.max_tokens_per_request = body.max_tokens_per_request
        config.temperature = body.temperature
    else:
        config = TeamLLMConfig(
            team_id=team_id,
            provider_name=body.provider_name,
            chat_model=body.chat_model,
            embedding_model=body.embedding_model,
            max_tokens_per_request=body.max_tokens_per_request,
            temperature=body.temperature,
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)
    return config


# ── Users ──────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()

    # Get team memberships for all users
    memberships = (await db.execute(
        select(TeamMember.user_id, Team.id, Team.name, TeamMember.role_in_team)
        .join(Team, Team.id == TeamMember.team_id)
    )).all()

    user_teams: dict[str, list] = {}
    for user_id, team_id, team_name, role in memberships:
        user_teams.setdefault(str(user_id), []).append({
            "team_id": str(team_id), "team_name": team_name, "role": role,
        })

    return [
        {
            "id": str(u.id), "email": u.email, "name": u.name,
            "is_super_admin": u.is_super_admin, "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
            "teams": user_teams.get(str(u.id), []),
        }
        for u in users
    ]


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")
    if user.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from sqlalchemy import delete as sa_delete

    # Remove team memberships and invite links
    await db.execute(sa_delete(TeamMember).where(TeamMember.user_id == user_id))
    await db.execute(sa_delete(InviteLink).where(InviteLink.created_by == user_id))

    await db.delete(target)
    await db.commit()


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


# ── Teams ──────────────────────────────────────────────────────────────

@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")

    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from sqlalchemy import delete as sa_delete
    from app.chat.models import Conversation, ConversationDocument, Message
    from app.documents.models import Document, DocumentChunk
    from app.providers.models import TeamLLMConfig

    # 1. Get IDs for cascading deletes
    conv_ids = (await db.execute(
        select(Conversation.id).where(Conversation.team_id == team_id)
    )).scalars().all()
    doc_ids = (await db.execute(
        select(Document.id).where(Document.team_id == team_id)
    )).scalars().all()

    # 2. Delete junction rows
    if conv_ids:
        await db.execute(sa_delete(ConversationDocument).where(ConversationDocument.conversation_id.in_(conv_ids)))
    if doc_ids:
        await db.execute(sa_delete(ConversationDocument).where(ConversationDocument.document_id.in_(doc_ids)))

    # 3. Delete messages and conversations
    if conv_ids:
        await db.execute(sa_delete(Message).where(Message.conversation_id.in_(conv_ids)))
        await db.execute(sa_delete(Conversation).where(Conversation.team_id == team_id))

    # 4. Delete document chunks and documents
    if doc_ids:
        await db.execute(sa_delete(DocumentChunk).where(DocumentChunk.document_id.in_(doc_ids)))
    await db.execute(sa_delete(Document).where(Document.team_id == team_id))

    # 5. Delete team config, invites, members
    await db.execute(sa_delete(TeamLLMConfig).where(TeamLLMConfig.team_id == team_id))
    await db.execute(sa_delete(InviteLink).where(InviteLink.team_id == team_id))
    await db.execute(sa_delete(TeamMember).where(TeamMember.team_id == team_id))

    # 6. Delete team
    await db.delete(team)
    await db.commit()

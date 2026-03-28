import io
import json
import uuid
import zipfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.importer import import_pack_from_zip
from app.auth.dependencies import get_current_user
from app.auth.models import Team, User
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
    result = await db.execute(select(PromptPack).order_by(PromptPack.created_at.desc()))
    packs = result.scalars().all()
    return [
        PromptPackResponse(
            id=p.id, name=p.name, version=p.version, description=p.description,
            team_id=p.team_id, created_at=p.created_at.isoformat(),
        )
        for p in packs
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


@router.post("/packs/import")
async def import_pack(
    file: UploadFile, name: str = "Imported Pack",
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


# --- LLM Provider Config ---

from app.providers.models import LLMProviderConfig, TeamLLMConfig
from pydantic import BaseModel


class LLMProviderConfigCreate(BaseModel):
    name: str  # anthropic, openai, openrouter, ollama
    base_url: str | None = None
    api_key: str | None = None
    is_enabled: bool = True


class LLMProviderConfigResponse(BaseModel):
    id: uuid.UUID
    name: str
    base_url: str | None
    has_api_key: bool
    is_enabled: bool

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
    else:
        provider = LLMProviderConfig(
            name=body.name,
            base_url=body.base_url,
            api_key_encrypted=body.api_key,  # TODO: encrypt in production
            is_enabled=body.is_enabled,
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
    await db.commit()
    await db.refresh(provider)
    return LLMProviderConfigResponse(
        id=provider.id, name=provider.name, base_url=provider.base_url,
        has_api_key=bool(provider.api_key_encrypted), is_enabled=provider.is_enabled,
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
    base_url = provider.base_url if provider else ""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if provider_name == "ollama":
                url = (base_url or "http://host.docker.internal:11434") + "/api/tags"
                res = await client.get(url)
                res.raise_for_status()
                data = res.json()
                models = [m["name"] for m in data.get("models", [])]
                return {"provider": provider_name, "models": models}

            elif provider_name == "openrouter":
                res = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
                )
                res.raise_for_status()
                data = res.json()
                models = [m["id"] for m in data.get("data", [])]
                return {"provider": provider_name, "models": models[:100]}  # limit to 100

            elif provider_name == "openai":
                if not api_key:
                    return {"provider": provider_name, "models": [], "error": "No API key configured"}
                res = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                res.raise_for_status()
                data = res.json()
                # Filter to chat models only
                chat_models = [
                    m["id"] for m in data.get("data", [])
                    if any(k in m["id"] for k in ["gpt-4", "gpt-3.5", "o1", "o3"])
                ]
                return {"provider": provider_name, "models": sorted(chat_models)}

            elif provider_name == "anthropic":
                # Anthropic doesn't have a models list API — return known models
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

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.auth.service import get_user_team_role
from app.chat.models import Conversation, ConversationDocument, Message
from app.chat.schemas import (
    ChatRequest,
    ConversationListResponse,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
)
from app.chat.service import generate_title, get_or_create_conversation, prepare_chat, stream_chat_response
from app.config import settings
from app.database import get_db
from app.providers.base import LLMConfig
from app.providers.models import LLMProviderConfig, TeamLLMConfig

router = APIRouter(prefix="/api/chat", tags=["chat"])


async def _load_llm_config(db: AsyncSession, team_id: uuid.UUID) -> tuple[str, LLMConfig]:
    """Load LLM provider config for a team. Falls back to env defaults."""
    # Try team-specific config first
    result = await db.execute(select(TeamLLMConfig).where(TeamLLMConfig.team_id == team_id))
    team_config = result.scalar_one_or_none()

    if team_config:
        # Load provider's API key
        provider_result = await db.execute(
            select(LLMProviderConfig).where(LLMProviderConfig.name == team_config.provider_name)
        )
        provider = provider_result.scalar_one_or_none()
        api_key = provider.api_key_encrypted if provider else ""
        base_url = provider.base_url if provider else ""

        return team_config.provider_name, LLMConfig(
            model=team_config.chat_model,
            api_key=api_key or "",
            base_url=base_url or "",
            temperature=team_config.temperature,
            max_tokens=team_config.max_tokens_per_request,
        )

    # Fallback: try to find any configured provider from env
    if settings.anthropic_api_key:
        return "anthropic", LLMConfig(
            model="claude-sonnet-4-20250514",
            api_key=settings.anthropic_api_key,
            temperature=0.7, max_tokens=4096,
        )
    if settings.openai_api_key:
        return "openai", LLMConfig(
            model="gpt-4o",
            api_key=settings.openai_api_key,
            temperature=0.7, max_tokens=4096,
        )
    if settings.openrouter_api_key:
        return "openrouter", LLMConfig(
            model="anthropic/claude-sonnet-4-20250514",
            api_key=settings.openrouter_api_key,
            temperature=0.7, max_tokens=4096,
        )
    # Ollama doesn't need an API key
    return "ollama", LLMConfig(
        model="llama3",
        base_url=settings.ollama_base_url,
        temperature=0.7, max_tokens=4096,
    )


async def _load_llm_config_from_env(db: AsyncSession) -> tuple[str, LLMConfig]:
    """Load LLM config: try first enabled DB provider, then fall back to env vars."""
    # Try DB-configured providers first (same ones visible in Admin → Providers)
    result = await db.execute(
        select(LLMProviderConfig).where(LLMProviderConfig.is_enabled.is_(True))
    )
    db_provider = result.scalars().first()
    if db_provider and db_provider.default_model:
        return db_provider.name, LLMConfig(
            model=db_provider.default_model,
            api_key=db_provider.api_key_encrypted or "",
            base_url=db_provider.base_url or "",
            temperature=0.7, max_tokens=4096,
        )

    # Fall back to env vars
    if settings.anthropic_api_key:
        return "anthropic", LLMConfig(
            model="claude-sonnet-4-20250514", api_key=settings.anthropic_api_key,
            temperature=0.7, max_tokens=4096,
        )
    if settings.openai_api_key:
        return "openai", LLMConfig(
            model="gpt-4o", api_key=settings.openai_api_key,
            temperature=0.7, max_tokens=4096,
        )
    if settings.openrouter_api_key:
        return "openrouter", LLMConfig(
            model="anthropic/claude-sonnet-4-20250514", api_key=settings.openrouter_api_key,
            temperature=0.7, max_tokens=4096,
        )
    return "ollama", LLMConfig(
        model="llama3", base_url=settings.ollama_base_url,
        temperature=0.7, max_tokens=4096,
    )


@router.post("/stream")
async def chat_stream(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.team_id:
        role = await get_user_team_role(db, user.id, body.team_id)
        if role is None and not user.is_super_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    conversation = await get_or_create_conversation(
        db, body.conversation_id, body.team_id, user.id, body.mode, body.document_ids
    )

    if body.team_id:
        provider_name, llm_config = await _load_llm_config(db, body.team_id)
    else:
        provider_name, llm_config = await _load_llm_config_from_env(db)

    # Prepare: compile prompt, detect mode, calculate budget
    prepared = await prepare_chat(
        db, conversation, body.message, body.document_ids,
        provider_name, llm_config, basic_mode=body.basic_mode,
    )
    compiled = prepared["compiled"]

    import json as _json

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

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/debug-compile")
async def debug_compile(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Debug endpoint: shows what the compiler would produce without calling the LLM."""
    from app.chat.service import load_pack_for_team
    from app.compiler.compiler import PromptCompiler
    from app.documents.retriever import retrieve_document_context
    from app.providers.registry import get_provider

    provider_name, llm_config = await _load_llm_config(db, body.team_id)
    pack_data = await load_pack_for_team(db, body.team_id)

    provider = get_provider(provider_name)
    if provider and hasattr(provider, "fetch_context_size"):
        context_limit = await provider.fetch_context_size(
            llm_config.model, llm_config.base_url or "http://localhost:11434"
        )
    elif provider:
        context_limit = provider.max_context_tokens(llm_config.model)
    else:
        context_limit = 128000

    if pack_data:
        compiler = PromptCompiler(
            modules=pack_data["modules"], modes=pack_data["modes"],
            model_context_limit=context_limit, condensed_core=pack_data["condensed_core"],
        )
    else:
        compiler = PromptCompiler(modules=[], modes=[], model_context_limit=context_limit, condensed_core=None)

    doc_context = ""
    if body.document_ids:
        doc_context = await retrieve_document_context(db, body.document_ids, query_embedding=None)

    compiled = compiler.compile(
        user_text=body.message, mode=body.mode, doc_context=doc_context,
    )

    return {
        "provider": provider_name,
        "model": llm_config.model,
        "context_limit": context_limit,
        "modules_loaded": compiled["modules_loaded"],
        "domains_matched": compiled["domains_matched"],
        "mode_detected": compiled["mode"],
        "core_mode": compiled["core_mode"],
        "total_tokens": compiled["total_tokens"],
        "budget_remaining": compiled["budget_remaining"],
        "trimmed": compiled["trimmed"],
        "system_prompt_preview": compiled["system_prompt"][:2000] + "..." if len(compiled["system_prompt"]) > 2000 else compiled["system_prompt"],
        "system_prompt_length": len(compiled["system_prompt"]),
    }


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


@router.delete("/conversations/personal/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_personal_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.team_id.is_(None),
            Conversation.user_id == user.id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from sqlalchemy import delete as sa_delete
    await db.execute(sa_delete(ConversationDocument).where(ConversationDocument.conversation_id == conversation_id))
    await db.delete(conv)
    await db.commit()


@router.delete("/conversations/{team_id}/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    team_id: uuid.UUID, conversation_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.team_id == team_id,
            Conversation.user_id == user.id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from sqlalchemy import delete as sa_delete
    await db.execute(
        sa_delete(ConversationDocument).where(ConversationDocument.conversation_id == conversation_id)
    )
    await db.delete(conv)
    await db.commit()


@router.get("/conversations/personal/{conversation_id}/messages", response_model=list[MessageResponse])
async def get_personal_messages(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.team_id.is_(None),
            Conversation.user_id == user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    messages = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at.asc())
    )
    return messages.scalars().all()


@router.get("/conversations/{team_id}/{conversation_id}/messages", response_model=list[MessageResponse])
async def get_messages(
    team_id: uuid.UUID, conversation_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.team_id == team_id,
            Conversation.user_id == user.id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    messages = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    return messages.scalars().all()

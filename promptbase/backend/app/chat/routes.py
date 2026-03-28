import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.auth.service import get_user_team_role
from app.chat.models import Conversation, Message
from app.chat.schemas import (
    ChatRequest,
    ConversationListResponse,
    ConversationResponse,
    MessageResponse,
)
from app.chat.service import get_or_create_conversation, stream_chat_response
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


@router.post("/stream")
async def chat_stream(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, body.team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    conversation = await get_or_create_conversation(
        db, body.conversation_id, body.team_id, user.id, body.mode, body.document_ids
    )

    provider_name, llm_config = await _load_llm_config(db, body.team_id)

    async def event_stream():
        yield f"data: {{\"conversation_id\": \"{conversation.id}\"}}\n\n"
        try:
            async for token in stream_chat_response(
                db, conversation, body.message, body.document_ids,
                provider_name=provider_name, llm_config=llm_config,
            ):
                escaped = token.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: [ERROR] {str(e)[:500]}\n\n"
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
    context_limit = provider.max_context_tokens(llm_config.model) if provider else 128000

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


@router.get("/conversations/{team_id}", response_model=ConversationListResponse)
async def list_conversations(
    team_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(
        select(Conversation)
        .where(Conversation.team_id == team_id, Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
    )
    convs = result.scalars().all()
    return ConversationListResponse(conversations=[
        ConversationResponse(
            id=c.id, title=c.title, mode=c.mode,
            created_at=c.created_at, updated_at=c.updated_at,
        )
        for c in convs
    ])


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

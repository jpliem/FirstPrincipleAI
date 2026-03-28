import uuid
from collections.abc import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Team
from app.chat.models import Conversation, ConversationDocument, Message
from app.compiler.budget import count_tokens_approx
from app.compiler.compiler import PromptCompiler
from app.compiler.models import PromptModule, PromptPack, TaskMode
from app.documents.retriever import retrieve_document_context
from app.providers.base import LLMConfig
from app.providers.registry import get_provider


async def get_or_create_conversation(
    db: AsyncSession,
    conversation_id: uuid.UUID | None,
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    mode: str | None,
    document_ids: list[uuid.UUID],
) -> Conversation:
    if conversation_id:
        result = await db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = result.scalar_one_or_none()
        if conv:
            return conv

    conv = Conversation(team_id=team_id, user_id=user_id, mode=mode)
    db.add(conv)
    await db.flush()

    for doc_id in document_ids:
        db.add(ConversationDocument(conversation_id=conv.id, document_id=doc_id))
    await db.flush()

    return conv


async def load_conversation_history(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    max_tokens: int = 8000,
) -> list[dict]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    messages = result.scalars().all()

    history = []
    total_tokens = 0
    for msg in reversed(messages):
        if total_tokens + msg.token_count > max_tokens:
            break
        history.insert(0, {"role": msg.role, "content": msg.content})
        total_tokens += msg.token_count

    return history


async def load_pack_for_team(db: AsyncSession, team_id: uuid.UUID) -> dict | None:
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team or not team.pack_id:
        return None

    pack_result = await db.execute(select(PromptPack).where(PromptPack.id == team.pack_id))
    pack = pack_result.scalar_one_or_none()
    if not pack:
        return None

    modules_result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack.id).order_by(PromptModule.sort_order)
    )
    modules = [
        {
            "name": m.title, "layer": m.layer, "content": m.content,
            "tags": m.tags or [], "priority": m.priority, "sort_order": m.sort_order,
        }
        for m in modules_result.scalars().all()
    ]

    modes_result = await db.execute(select(TaskMode).where(TaskMode.pack_id == pack.id))
    modes = [{"name": m.name, "prompt_text": m.prompt_text} for m in modes_result.scalars().all()]

    return {"modules": modules, "modes": modes, "condensed_core": pack.condensed_core}


async def stream_chat_response(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    document_ids: list[uuid.UUID],
    provider_name: str,
    llm_config: LLMConfig,
) -> AsyncIterator[str]:
    user_msg = Message(
        conversation_id=conversation.id, role="user",
        content=user_message, token_count=count_tokens_approx(user_message),
    )
    db.add(user_msg)
    await db.flush()

    if conversation.title == "New conversation":
        conversation.title = user_message[:100]
        await db.flush()

    pack_data = await load_pack_for_team(db, conversation.team_id)

    # Get the provider's actual context window, not the response max_tokens
    provider = get_provider(provider_name)
    if provider:
        context_limit = provider.max_context_tokens(llm_config.model)
    else:
        context_limit = 128000

    if pack_data:
        compiler = PromptCompiler(
            modules=pack_data["modules"], modes=pack_data["modes"],
            model_context_limit=context_limit,
            condensed_core=pack_data["condensed_core"],
        )
    else:
        compiler = PromptCompiler(modules=[], modes=[], model_context_limit=context_limit, condensed_core=None)

    doc_context = ""
    if document_ids:
        doc_context = await retrieve_document_context(db, document_ids, query_embedding=None)

    history = await load_conversation_history(db, conversation.id, max_tokens=8000)

    compiled = compiler.compile(
        user_text=user_message, mode=conversation.mode, doc_context=doc_context,
        history_tokens=sum(count_tokens_approx(m["content"]) for m in history),
    )

    if not provider:
        yield f"Error: Provider '{provider_name}' not found"
        return

    import logging
    logger = logging.getLogger("promptbase.chat")
    logger.info(
        "Compiled prompt: %d modules loaded, %d tokens, core_mode=%s, mode=%s, trimmed=%s",
        len(compiled["modules_loaded"]), compiled["total_tokens"],
        compiled.get("core_mode"), compiled.get("mode"), compiled.get("trimmed"),
    )

    messages = history + [{"role": "user", "content": user_message}]
    full_response = ""

    async for token in provider.stream_chat(compiled["system_prompt"], messages, llm_config):
        full_response += token
        yield token

    assistant_msg = Message(
        conversation_id=conversation.id, role="assistant",
        content=full_response, token_count=count_tokens_approx(full_response),
    )
    db.add(assistant_msg)
    await db.commit()

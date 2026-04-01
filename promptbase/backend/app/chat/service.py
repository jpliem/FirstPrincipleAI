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


async def prepare_chat(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    document_ids: list[uuid.UUID],
    provider_name: str,
    llm_config: LLMConfig,
    basic_mode: bool = False,
) -> dict:
    """Prepare the chat: save user message, compile prompt, return metadata + ready state."""
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

    provider = get_provider(provider_name)
    if provider and hasattr(provider, "fetch_context_size"):
        context_limit = await provider.fetch_context_size(
            llm_config.model, llm_config.base_url or "http://localhost:11434"
        )
    elif provider:
        context_limit = provider.max_context_tokens(llm_config.model)
    else:
        context_limit = 128000

    # Tell the provider what context size to request (important for Ollama)
    llm_config.max_context = context_limit

    if basic_mode:
        # Skip prompt pack compilation — plain chat
        doc_context = ""
        if document_ids:
            doc_context = await retrieve_document_context(db, document_ids, query_embedding=None)

        system_prompt = "You are a helpful assistant."
        if doc_context:
            system_prompt += f"\n\n## Reference Documents\n\n{doc_context}"

        history = await load_conversation_history(db, conversation.id, max_tokens=8000)
        history_tokens = sum(count_tokens_approx(m["content"]) for m in history)
        prompt_tokens = count_tokens_approx(system_prompt)
        used_tokens = prompt_tokens + history_tokens + count_tokens_approx(user_message)
        dynamic_max = max(1024, context_limit - used_tokens - 256)
        llm_config.max_tokens = min(llm_config.max_tokens, dynamic_max)

        return {
            "provider": provider,
            "compiled": {
                "system_prompt": system_prompt,
                "total_tokens": prompt_tokens,
                "modules_loaded": [],
                "modules_by_layer": {},
                "domains_matched": [],
                "mode": "basic",
                "trimmed": [],
                "budget_remaining": context_limit - used_tokens,
                "core_mode": None,
            },
            "history": history,
            "context_limit": context_limit,
            "llm_config": llm_config,
        }

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

    # Dynamic max_tokens
    history_tokens = sum(count_tokens_approx(m["content"]) for m in history)
    used_tokens = compiled["total_tokens"] + history_tokens + count_tokens_approx(user_message)
    dynamic_max = max(1024, context_limit - used_tokens - 256)
    llm_config.max_tokens = min(llm_config.max_tokens, dynamic_max)

    return {
        "provider": provider,
        "compiled": compiled,
        "history": history,
        "context_limit": context_limit,
        "llm_config": llm_config,
    }


async def stream_chat_response(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    prepared: dict,
) -> AsyncIterator[tuple[str, str]]:
    """Stream the LLM response, parsing <think> tags into typed events."""
    from app.chat.think_parser import ThinkTagParser

    provider = prepared["provider"]
    compiled = prepared["compiled"]
    history = prepared["history"]
    llm_config = prepared["llm_config"]

    if not provider:
        yield ("text", "Error: Provider not found")
        return

    messages = history + [{"role": "user", "content": user_message}]
    parser = ThinkTagParser()

    async for token in provider.stream_chat(compiled["system_prompt"], messages, llm_config):
        for event in parser.feed(token):
            yield event

    for event in parser.flush():
        yield event

    # Save message with separated content
    content = parser.text_content
    thinking = parser.thinking_content or None

    assistant_msg = Message(
        conversation_id=conversation.id, role="assistant",
        content=content, thinking_content=thinking,
        token_count=count_tokens_approx(content),
    )
    db.add(assistant_msg)
    await db.commit()


async def generate_title(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    assistant_content: str,
    provider_name: str,
    llm_config: LLMConfig,
) -> str | None:
    """Generate an AI title for a conversation after the first exchange."""
    from app.providers.registry import get_provider

    # Only auto-name on the first exchange
    result = await db.execute(
        select(Message).where(Message.conversation_id == conversation.id)
    )
    msg_count = len(result.scalars().all())
    if msg_count != 2:
        return None

    provider = get_provider(provider_name)
    if not provider:
        return None

    prompt = "Summarize this conversation in 5-8 words as a title. Reply with only the title, no quotes."
    messages = [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": assistant_content[:200]},
    ]

    title_config = LLMConfig(
        model=llm_config.model,
        api_key=llm_config.api_key,
        base_url=llm_config.base_url,
        temperature=0.3,
        max_tokens=30,
    )

    try:
        title = ""
        async for token in provider.stream_chat(prompt, messages, title_config):
            title += token
        title = title.strip().strip('"').strip("'")[:200]
        if title:
            conversation.title = title
            await db.commit()
            return title
    except Exception:
        pass
    return None

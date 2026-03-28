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
from app.database import get_db
from app.providers.base import LLMConfig

router = APIRouter(prefix="/api/chat", tags=["chat"])


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

    # TODO: Load provider config from team_llm_config table
    llm_config = LLMConfig(
        model="claude-sonnet-4-20250514", api_key="",
        temperature=0.7, max_tokens=4096,
    )

    async def event_stream():
        yield f"data: {{\"conversation_id\": \"{conversation.id}\"}}\n\n"
        async for token in stream_chat_response(
            db, conversation, body.message, body.document_ids,
            provider_name="anthropic", llm_config=llm_config,
        ):
            escaped = token.replace("\n", "\\n")
            yield f"data: {escaped}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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

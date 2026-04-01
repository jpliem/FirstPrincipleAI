import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    conversation_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] = []
    mode: str | None = None
    basic_mode: bool = False


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    thinking_content: str | None = None
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationUpdate(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    mode: str | None
    is_pinned: bool = False
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    conversations: list[ConversationResponse]

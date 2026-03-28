import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    file_size: int
    status: str
    progress: int = 0
    strategy: str | None
    token_count: int
    conversation_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]


class AttachRequest(BaseModel):
    document_id: uuid.UUID

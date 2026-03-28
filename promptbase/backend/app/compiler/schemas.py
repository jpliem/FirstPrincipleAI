import uuid

from pydantic import BaseModel


class PromptModuleCreate(BaseModel):
    filename: str
    title: str
    layer: str
    tags: list[str] = []
    priority: int = 50
    content: str
    max_tokens: int | None = None
    sort_order: int = 0


class PromptModuleResponse(BaseModel):
    id: uuid.UUID
    filename: str
    title: str
    layer: str
    tags: list[str]
    priority: int
    content: str
    token_count: int
    sort_order: int

    model_config = {"from_attributes": True}


class PromptPackCreate(BaseModel):
    name: str
    version: str = "1.0.0"
    description: str = ""


class PromptPackResponse(BaseModel):
    id: uuid.UUID
    name: str
    version: str
    description: str
    team_id: uuid.UUID | None
    created_at: str
    module_count: int = 0

    model_config = {"from_attributes": True}


class TaskModeCreate(BaseModel):
    name: str
    prompt_text: str
    form_schema: dict | None = None
    sort_order: int = 0


class TaskModeResponse(BaseModel):
    id: uuid.UUID
    name: str
    prompt_text: str
    form_schema: dict | None
    sort_order: int

    model_config = {"from_attributes": True}


class CompiledPromptDebug(BaseModel):
    total_tokens: int
    core_tokens: int
    domain_tokens: int
    mode_tokens: int
    doc_tokens: int
    modules_loaded: list[str]
    domains_matched: list[str]
    mode: str | None
    model_context_limit: int
    budget_remaining: int

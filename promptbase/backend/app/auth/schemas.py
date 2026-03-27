import uuid
from datetime import datetime

from pydantic import BaseModel


class UserRegister(BaseModel):
    email: str
    password: str
    name: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    is_super_admin: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TeamCreate(BaseModel):
    name: str
    description: str = ""


class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    pack_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TeamMemberResponse(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role_in_team: str
    joined_at: datetime | None

    model_config = {"from_attributes": True}


class InviteCreate(BaseModel):
    expire_hours: int = 72

import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import InviteLink, Team, TeamMember, User
from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
    payload = {"sub": str(user_id), "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError:
        return None


async def register_user(db: AsyncSession, email: str, password: str, name: str) -> User:
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(password),
        name=name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.password_hash):
        return user
    return None


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def create_team(db: AsyncSession, name: str, description: str, creator_id: uuid.UUID) -> Team:
    team = Team(name=name, description=description)
    db.add(team)
    await db.flush()

    member = TeamMember(
        team_id=team.id,
        user_id=creator_id,
        role_in_team="admin",
        joined_at=datetime.now(UTC),
    )
    db.add(member)
    await db.commit()
    await db.refresh(team)
    return team


async def create_invite(db: AsyncSession, team_id: uuid.UUID, created_by: uuid.UUID, expire_hours: int = 72) -> InviteLink:
    invite = InviteLink(
        team_id=team_id,
        created_by=created_by,
        token=str(uuid.uuid4()),
        expires_at=datetime.now(UTC) + timedelta(hours=expire_hours),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


async def accept_invite(db: AsyncSession, token: str, user_id: uuid.UUID) -> TeamMember:
    result = await db.execute(select(InviteLink).where(InviteLink.token == token))
    invite = result.scalar_one_or_none()

    if not invite:
        raise ValueError("Invalid invite link")
    if invite.expires_at < datetime.now(UTC):
        raise ValueError("Invite link expired")
    if invite.used_by is not None:
        raise ValueError("Invite link already used")

    member = TeamMember(
        team_id=invite.team_id,
        user_id=user_id,
        role_in_team="member",
        joined_at=datetime.now(UTC),
    )
    db.add(member)
    invite.used_by = user_id
    await db.commit()
    await db.refresh(member)
    return member


async def get_user_team_role(db: AsyncSession, user_id: uuid.UUID, team_id: uuid.UUID) -> str | None:
    result = await db.execute(
        select(TeamMember.role_in_team).where(
            TeamMember.user_id == user_id,
            TeamMember.team_id == team_id,
        )
    )
    return result.scalar_one_or_none()

# PromptBase Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PromptBase backend — a FastAPI application that compiles prompt packs into system prompts, routes to multiple LLM providers, handles document upload/retrieval, streams chat responses via SSE, exports to Word documents, and manages multi-tenant auth.

**Architecture:** Modular monolith — single FastAPI app with isolated modules (auth, chat, compiler, documents, providers, export, admin). Document processing runs as Celery background tasks via Redis. PostgreSQL + pgvector for relational + vector storage. All modules communicate through service-layer interfaces, not direct model imports across boundaries.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Alembic, Celery, Redis, PostgreSQL + pgvector, python-docx, mistune, PyMuPDF, pdfplumber, anthropic SDK, openai SDK, httpx, bcrypt, python-jose, tiktoken

**Spec:** `docs/superpowers/specs/2026-03-27-promptbase-design.md`

---

## File Structure

```
promptbase/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
│
└── backend/
    ├── Dockerfile
    ├── pyproject.toml
    ├── alembic.ini
    ├── alembic/
    │   ├── env.py
    │   └── versions/
    │
    └── app/
        ├── main.py
        ├── config.py
        ├── database.py
        │
        ├── auth/
        │   ├── __init__.py
        │   ├── models.py
        │   ├── schemas.py
        │   ├── routes.py
        │   ├── service.py
        │   └── dependencies.py
        │
        ├── compiler/
        │   ├── __init__.py
        │   ├── models.py
        │   ├── schemas.py
        │   ├── classifier.py
        │   ├── compiler.py
        │   └── budget.py
        │
        ├── providers/
        │   ├── __init__.py
        │   ├── base.py
        │   ├── anthropic.py
        │   ├── openai_provider.py
        │   ├── openrouter.py
        │   ├── ollama.py
        │   └── registry.py
        │
        ├── documents/
        │   ├── __init__.py
        │   ├── models.py
        │   ├── schemas.py
        │   ├── routes.py
        │   ├── parser.py
        │   ├── chunker.py
        │   └── retriever.py
        │
        ├── chat/
        │   ├── __init__.py
        │   ├── models.py
        │   ├── schemas.py
        │   ├── routes.py
        │   └── service.py
        │
        ├── export/
        │   ├── __init__.py
        │   ├── routes.py
        │   ├── renderer.py
        │   ├── pdf.py
        │   └── templates/
        │       └── default.docx
        │
        ├── admin/
        │   ├── __init__.py
        │   ├── routes.py
        │   └── importer.py
        │
        └── workers/
            ├── __init__.py
            ├── celery_app.py
            └── tasks.py
```

---

## Phase 1: Foundation

### Task 1: Project Scaffolding & Docker

**Files:**
- Create: `promptbase/docker-compose.yml`
- Create: `promptbase/docker-compose.dev.yml`
- Create: `promptbase/.env.example`
- Create: `promptbase/.gitignore`
- Create: `promptbase/backend/Dockerfile`
- Create: `promptbase/backend/pyproject.toml`
- Create: `promptbase/backend/app/__init__.py`
- Create: `promptbase/backend/app/main.py`
- Create: `promptbase/backend/app/config.py`

- [ ] **Step 1: Create project root and .gitignore**

```bash
mkdir -p promptbase/backend/app
```

Write `promptbase/.gitignore`:

```gitignore
__pycache__/
*.pyc
.env
.venv/
*.egg-info/
dist/
build/
.superpowers/
node_modules/
```

- [ ] **Step 2: Create .env.example**

Write `promptbase/.env.example`:

```env
# Database
DATABASE_URL=postgresql+asyncpg://promptbase:promptbase@db:5432/promptbase

# Redis
REDIS_URL=redis://redis:6379/0

# Auth
JWT_SECRET=change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# File Storage
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_SIZE_MB=50

# Document Processing
RAG_THRESHOLD_TOKENS=8000
DEFAULT_CHUNK_SIZE=500
DEFAULT_CHUNK_OVERLAP=50
DEFAULT_TOP_K=5

# OCR Microservice (optional)
OCR_SERVICE_URL=

# LLM Providers (configured per-team in DB, these are defaults)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
```

- [ ] **Step 3: Create pyproject.toml**

Write `promptbase/backend/pyproject.toml`:

```toml
[project]
name = "promptbase"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "sqlalchemy[asyncio]>=2.0.0",
    "asyncpg>=0.29.0",
    "alembic>=1.13.0",
    "pgvector>=0.3.0",
    "celery[redis]>=5.4.0",
    "redis>=5.0.0",
    "python-jose[cryptography]>=3.3.0",
    "bcrypt>=4.1.0",
    "python-multipart>=0.0.9",
    "httpx>=0.27.0",
    "anthropic>=0.39.0",
    "openai>=1.50.0",
    "tiktoken>=0.7.0",
    "python-docx>=1.1.0",
    "mistune>=3.0.0",
    "PyMuPDF>=1.24.0",
    "pdfplumber>=0.11.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.5.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.27.0",
    "factory-boy>=3.3.0",
]

[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"
```

- [ ] **Step 4: Create config.py**

Write `promptbase/backend/app/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://promptbase:promptbase@db:5432/promptbase"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    upload_dir: str = "/app/uploads"
    max_upload_size_mb: int = 50

    rag_threshold_tokens: int = 8000
    default_chunk_size: int = 500
    default_chunk_overlap: int = 50
    default_top_k: int = 5

    ocr_service_url: str = ""

    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
```

- [ ] **Step 5: Create main.py with health check**

Write `promptbase/backend/app/__init__.py`:

```python
```

Write `promptbase/backend/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="PromptBase", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
```

- [ ] **Step 6: Create Dockerfile**

Write `promptbase/backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Step 7: Create docker-compose.dev.yml**

Write `promptbase/docker-compose.dev.yml`:

```yaml
services:
  api:
    build:
      context: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
      - upload_data:/app/uploads
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  worker:
    build:
      context: ./backend
    command: celery -A app.workers.celery_app worker --loglevel=info
    volumes:
      - ./backend:/app
      - upload_data:/app/uploads
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: promptbase
      POSTGRES_PASSWORD: promptbase
      POSTGRES_DB: promptbase
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U promptbase"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

volumes:
  pg_data:
  upload_data:
```

- [ ] **Step 8: Create docker-compose.yml (production)**

Write `promptbase/docker-compose.yml`:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - frontend_build:/usr/share/nginx/html
    depends_on:
      - api

  api:
    build:
      context: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    volumes:
      - upload_data:/app/uploads
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  worker:
    build:
      context: ./backend
    command: celery -A app.workers.celery_app worker --loglevel=info
    volumes:
      - upload_data:/app/uploads
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:alpine

volumes:
  pg_data:
  upload_data:
  frontend_build:
```

- [ ] **Step 9: Verify Docker dev stack starts**

```bash
cd promptbase
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --build
```

Wait for services, then:

```bash
curl http://localhost:8000/api/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 10: Commit**

```bash
git init
git add .
git commit -m "feat: project scaffolding with Docker, FastAPI, Postgres, Redis"
```

---

### Task 2: Database Setup & Alembic

**Files:**
- Create: `promptbase/backend/app/database.py`
- Create: `promptbase/backend/alembic.ini`
- Create: `promptbase/backend/alembic/env.py`

- [ ] **Step 1: Create database.py**

Write `promptbase/backend/app/database.py`:

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
```

- [ ] **Step 2: Initialize Alembic**

```bash
cd promptbase/backend
pip install alembic asyncpg pgvector
alembic init alembic
```

- [ ] **Step 3: Configure alembic/env.py**

Replace `promptbase/backend/alembic/env.py`:

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings
from app.database import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online():
    connectable = create_async_engine(settings.database_url)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 4: Update alembic.ini**

In `promptbase/backend/alembic.ini`, set:

```ini
sqlalchemy.url = postgresql+asyncpg://promptbase:promptbase@localhost:5432/promptbase
```

- [ ] **Step 5: Register pgvector extension via initial migration**

```bash
cd promptbase/backend
alembic revision -m "enable pgvector extension"
```

In the generated migration file, write:

```python
"""enable pgvector extension"""

from alembic import op


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade():
    op.execute("DROP EXTENSION IF EXISTS vector")
```

- [ ] **Step 6: Run migration**

```bash
alembic upgrade head
```

Expected: Migration applies successfully, pgvector extension created.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: database setup with SQLAlchemy async and Alembic migrations"
```

---

### Task 3: Celery Worker Setup

**Files:**
- Create: `promptbase/backend/app/workers/__init__.py`
- Create: `promptbase/backend/app/workers/celery_app.py`
- Create: `promptbase/backend/app/workers/tasks.py`

- [ ] **Step 1: Create celery_app.py**

Write `promptbase/backend/app/workers/__init__.py`:

```python
```

Write `promptbase/backend/app/workers/celery_app.py`:

```python
from celery import Celery

from app.config import settings

celery = Celery(
    "promptbase",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)
```

- [ ] **Step 2: Create placeholder tasks.py**

Write `promptbase/backend/app/workers/tasks.py`:

```python
from app.workers.celery_app import celery


@celery.task(name="process_document")
def process_document(document_id: int):
    """Placeholder — implemented in Task 11."""
    pass
```

- [ ] **Step 3: Verify worker starts**

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml logs worker
```

Expected: Worker connects to Redis and is ready to receive tasks.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: Celery worker setup with Redis broker"
```

---

## Phase 2: Auth Module

### Task 4: Auth Models & Migration

**Files:**
- Create: `promptbase/backend/app/auth/__init__.py`
- Create: `promptbase/backend/app/auth/models.py`
- Create: `promptbase/backend/app/auth/schemas.py`

- [ ] **Step 1: Create auth models**

Write `promptbase/backend/app/auth/__init__.py`:

```python
```

Write `promptbase/backend/app/auth/models.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    team_memberships: Mapped[list["TeamMember"]] = relationship(back_populates="user")


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    pack_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("prompt_packs.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team")


class TeamMember(Base):
    __tablename__ = "team_members"

    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    role_in_team: Mapped[str] = mapped_column(String(20), default="member")  # admin | member
    invited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    team: Mapped["Team"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="team_memberships")


class InviteLink(Base):
    __tablename__ = "invite_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
```

- [ ] **Step 2: Create auth schemas**

Write `promptbase/backend/app/auth/schemas.py`:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


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
```

- [ ] **Step 3: Note — migration will be created after compiler models exist (Task 7) to avoid FK issues with prompt_packs table. Continue to Task 5.**

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: auth models and schemas for users, teams, invites"
```

---

### Task 5: Auth Service & Dependencies

**Files:**
- Create: `promptbase/backend/app/auth/service.py`
- Create: `promptbase/backend/app/auth/dependencies.py`

- [ ] **Step 1: Create auth service**

Write `promptbase/backend/app/auth/service.py`:

```python
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
```

- [ ] **Step 2: Create auth dependencies**

Write `promptbase/backend/app/auth/dependencies.py`:

```python
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.service import decode_token, get_user_by_id
from app.database import get_db

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = uuid.UUID(payload["sub"])
    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")
    return user
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: auth service with JWT, password hashing, team management"
```

---

### Task 6: Auth Routes

**Files:**
- Create: `promptbase/backend/app/auth/routes.py`
- Modify: `promptbase/backend/app/main.py`

- [ ] **Step 1: Create auth routes**

Write `promptbase/backend/app/auth/routes.py`:

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import Team, TeamMember, User
from app.auth.schemas import (
    InviteCreate,
    TeamCreate,
    TeamMemberResponse,
    TeamResponse,
    TokenResponse,
    UserLogin,
    UserRegister,
    UserResponse,
)
from app.auth.service import (
    accept_invite,
    authenticate_user,
    create_access_token,
    create_invite,
    create_refresh_token,
    create_team,
    decode_token,
    get_user_by_id,
    get_user_team_role,
    register_user,
)
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    try:
        user = await register_user(db, body.email, body.password, body.name)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(refresh_token: str, db: AsyncSession = Depends(get_db)):
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user_id = uuid.UUID(payload["sub"])
    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.post("/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_new_team(
    body: TeamCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    team = await create_team(db, body.name, body.description, user.id)
    return team


@router.get("/teams", response_model=list[TeamResponse])
async def list_my_teams(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Team)
        .join(TeamMember, Team.id == TeamMember.team_id)
        .where(TeamMember.user_id == user.id)
    )
    return result.scalars().all()


@router.post("/teams/{team_id}/invite")
async def invite_to_team(
    team_id: uuid.UUID,
    body: InviteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role != "admin" and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Team admin required")
    invite = await create_invite(db, team_id, user.id, body.expire_hours)
    return {"invite_token": invite.token, "expires_at": invite.expires_at.isoformat()}


@router.post("/invite/{token}/accept")
async def accept_team_invite(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        member = await accept_invite(db, token, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"team_id": str(member.team_id), "role": member.role_in_team}
```

- [ ] **Step 2: Register auth router in main.py**

In `promptbase/backend/app/main.py`, add after the CORS middleware:

```python
from app.auth.routes import router as auth_router

app.include_router(auth_router)
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: auth routes for register, login, teams, invites"
```

---

## Phase 3: Prompt Compiler

### Task 7: Compiler Models & Migration

**Files:**
- Create: `promptbase/backend/app/compiler/__init__.py`
- Create: `promptbase/backend/app/compiler/models.py`
- Create: `promptbase/backend/app/compiler/schemas.py`

- [ ] **Step 1: Create compiler models**

Write `promptbase/backend/app/compiler/__init__.py`:

```python
```

Write `promptbase/backend/app/compiler/models.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PromptPack(Base):
    __tablename__ = "prompt_packs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    version: Mapped[str] = mapped_column(String(50), default="1.0.0")
    description: Mapped[str] = mapped_column(Text, default="")
    team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    manifest: Mapped[dict] = mapped_column(JSON, default=dict)
    condensed_core: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    modules: Mapped[list["PromptModule"]] = relationship(back_populates="pack", cascade="all, delete-orphan")
    modes: Mapped[list["TaskMode"]] = relationship(back_populates="pack", cascade="all, delete-orphan")


class PromptModule(Base):
    __tablename__ = "prompt_modules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("prompt_packs.id"))
    filename: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255))
    layer: Mapped[str] = mapped_column(String(20))  # core | domain | always
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    priority: Mapped[int] = mapped_column(Integer, default=50)
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    pack: Mapped["PromptPack"] = relationship(back_populates="modules")


class TaskMode(Base):
    __tablename__ = "task_modes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("prompt_packs.id"))
    name: Mapped[str] = mapped_column(String(100))
    prompt_text: Mapped[str] = mapped_column(Text)
    form_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    pack: Mapped["PromptPack"] = relationship(back_populates="modes")
```

- [ ] **Step 2: Create compiler schemas**

Write `promptbase/backend/app/compiler/schemas.py`:

```python
import uuid

from pydantic import BaseModel


class PromptModuleCreate(BaseModel):
    filename: str
    title: str
    layer: str  # core | domain | always
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
```

- [ ] **Step 3: Generate migration for all models so far**

Import all models in alembic env.py so autogenerate sees them. Update `promptbase/backend/alembic/env.py` — add before `target_metadata`:

```python
from app.auth.models import User, Team, TeamMember, InviteLink  # noqa: F401
from app.compiler.models import PromptPack, PromptModule, TaskMode  # noqa: F401
```

Then generate:

```bash
cd promptbase/backend
alembic revision --autogenerate -m "auth and compiler tables"
```

- [ ] **Step 4: Run migration**

```bash
alembic upgrade head
```

Expected: Tables created — users, teams, team_members, invite_links, prompt_packs, prompt_modules, task_modes.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: compiler models, schemas, and database migration"
```

---

### Task 8: Request Classifier

**Files:**
- Create: `promptbase/backend/app/compiler/classifier.py`
- Create: `promptbase/backend/tests/__init__.py`
- Create: `promptbase/backend/tests/test_classifier.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/__init__.py`:

```python
```

Write `promptbase/backend/tests/test_classifier.py`:

```python
from app.compiler.classifier import classify_request


def test_classify_embedded_iot():
    domains = classify_request("We need to configure the PLC for the new sensor array")
    assert "embedded_iot" in domains


def test_classify_business_apps():
    domains = classify_request("Update the ERP warehouse module for QC integration")
    assert "business_apps" in domains


def test_classify_ai_ops():
    domains = classify_request("Set up the RAG pipeline with LLM evaluation")
    assert "ai_ops" in domains


def test_classify_platform():
    domains = classify_request("Deploy the service to Kubernetes with Docker")
    assert "platform" in domains


def test_classify_digital_thread():
    domains = classify_request("Update the BOM revision and traceability records")
    assert "digital_thread" in domains


def test_classify_reference_patterns():
    domains = classify_request("Design the solution architecture for the new system")
    assert "reference_patterns" in domains


def test_classify_multiple_domains():
    domains = classify_request("Deploy the AI agent to Kubernetes with Docker")
    assert "ai_ops" in domains
    assert "platform" in domains


def test_classify_no_match():
    domains = classify_request("Tell me a joke")
    assert len(domains) == 0


def test_classify_with_custom_modules():
    custom = [
        {"tags": ["solar", "inverter", "panel"], "domain_key": "solar_energy"},
    ]
    domains = classify_request("Install the solar panel inverter", custom_modules=custom)
    assert "solar_energy" in domains


def test_detect_mode_from_text():
    from app.compiler.classifier import detect_mode
    mode = detect_mode("Analyze the gaps in this tender specification")
    assert mode == "analysis"


def test_detect_mode_implementation():
    from app.compiler.classifier import detect_mode
    mode = detect_mode("Implement the API endpoint for user registration")
    assert mode == "implementation"


def test_detect_mode_none():
    from app.compiler.classifier import detect_mode
    mode = detect_mode("Tell me about the project")
    assert mode is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_classifier.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.compiler.classifier'`

- [ ] **Step 3: Implement classifier**

Write `promptbase/backend/app/compiler/classifier.py`:

```python
DEFAULT_DOMAIN_MODULES = [
    {
        "domain_key": "embedded_iot",
        "tags": ["plc", "firmware", "sensor", "iot", "embedded", "modbus", "snmp", "scada", "electronics", "microcontroller"],
    },
    {
        "domain_key": "business_apps",
        "tags": ["erp", "crm", "ppc", "warehouse", "qc", "production", "purchasing", "inventory", "logistics", "procurement"],
    },
    {
        "domain_key": "ai_ops",
        "tags": ["llm", "agent", "mlops", "ai", "rag", "eval", "vision", "embedding", "fine-tune", "prompt engineering"],
    },
    {
        "domain_key": "platform",
        "tags": ["cloud", "devops", "deploy", "docker", "kubernetes", "security", "ci/cd", "terraform", "aws", "azure", "gcp"],
    },
    {
        "domain_key": "digital_thread",
        "tags": ["bom", "config", "revision", "traceability", "digital thread", "configuration", "lifecycle", "as-built"],
    },
    {
        "domain_key": "reference_patterns",
        "tags": ["solution design", "architecture", "patterns", "reference architecture", "system design", "integration pattern"],
    },
]

MODE_KEYWORDS = {
    "analysis": ["analyze", "analysis", "review", "assess", "evaluate", "gap", "audit", "compare", "investigate"],
    "implementation": ["implement", "build", "create", "develop", "code", "write", "add feature", "set up"],
    "solution_design": ["design", "architect", "propose", "solution", "blueprint", "plan system"],
    "tender_response": ["tender", "rfp", "rfq", "proposal", "bid", "quotation", "compliance matrix"],
    "architecture_review": ["architecture review", "tech debt", "refactor assessment", "system review"],
    "business_process": ["process", "workflow", "procedure", "sop", "operating model"],
}


def classify_request(text: str, custom_modules: list[dict] | None = None) -> set[str]:
    text_lower = text.lower()
    domains = set()

    modules = DEFAULT_DOMAIN_MODULES + (custom_modules or [])

    for module in modules:
        for tag in module["tags"]:
            if tag.lower() in text_lower:
                domains.add(module["domain_key"])
                break

    return domains


def detect_mode(text: str) -> str | None:
    text_lower = text.lower()

    scores: dict[str, int] = {}
    for mode, keywords in MODE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                scores[mode] = scores.get(mode, 0) + 1

    if not scores:
        return None

    return max(scores, key=scores.get)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_classifier.py -v
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: request classifier with domain matching and mode detection"
```

---

### Task 9: Token Budget Manager

**Files:**
- Create: `promptbase/backend/app/compiler/budget.py`
- Create: `promptbase/backend/tests/test_budget.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/test_budget.py`:

```python
from app.compiler.budget import TokenBudget, count_tokens_approx


def test_count_tokens_approx():
    text = "Hello world this is a test"
    count = count_tokens_approx(text)
    assert 4 <= count <= 10  # ~6 tokens, rough estimate


def test_budget_fits():
    budget = TokenBudget(model_context_limit=128000)
    budget.reserve_for_response(4096)
    budget.reserve_for_history(2000)
    budget.add_section("core", "A " * 5000, priority=100)
    assert budget.fits()
    assert budget.remaining() > 100000


def test_budget_overflow_trims_lowest_priority():
    budget = TokenBudget(model_context_limit=1000)
    budget.reserve_for_response(200)
    budget.reserve_for_history(200)
    budget.add_section("core", "word " * 400, priority=100)  # ~400 tokens
    budget.add_section("domain_a", "word " * 300, priority=50)  # ~300 tokens — should be trimmed
    budget.add_section("domain_b", "word " * 100, priority=80)  # ~100 tokens

    result = budget.compile()
    assert "core" in result["included"]
    assert "domain_b" in result["included"]
    # domain_a may be trimmed or partially included depending on budget


def test_budget_use_condensed_core():
    budget = TokenBudget(model_context_limit=8000)
    budget.reserve_for_response(2000)
    budget.reserve_for_history(1000)

    full_core = "word " * 6000  # way over budget
    condensed = "word " * 1500  # fits

    result = budget.add_core_with_fallback(full_core, condensed)
    assert result == "condensed"


def test_budget_use_full_core():
    budget = TokenBudget(model_context_limit=128000)
    budget.reserve_for_response(4096)
    budget.reserve_for_history(2000)

    full_core = "word " * 6000
    condensed = "word " * 1500

    result = budget.add_core_with_fallback(full_core, condensed)
    assert result == "full"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_budget.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement budget manager**

Write `promptbase/backend/app/compiler/budget.py`:

```python
def count_tokens_approx(text: str) -> int:
    """Rough token estimate: ~0.75 tokens per word, ~4 chars per token.
    Good enough for budgeting. Use tiktoken for exact counts when needed."""
    return max(1, len(text) // 4)


class TokenBudget:
    def __init__(self, model_context_limit: int):
        self.model_context_limit = model_context_limit
        self.response_reserve = 0
        self.history_reserve = 0
        self.sections: list[dict] = []
        self.core_tokens = 0
        self.core_mode = None  # "full" | "condensed"

    def reserve_for_response(self, tokens: int):
        self.response_reserve = tokens

    def reserve_for_history(self, tokens: int):
        self.history_reserve = tokens

    @property
    def available(self) -> int:
        return self.model_context_limit - self.response_reserve - self.history_reserve - self.core_tokens

    def add_core_with_fallback(self, full_core: str, condensed_core: str | None) -> str:
        full_tokens = count_tokens_approx(full_core)
        budget_for_core = self.model_context_limit - self.response_reserve - self.history_reserve

        if full_tokens <= budget_for_core * 0.6:  # core shouldn't exceed 60% of available
            self.core_tokens = full_tokens
            self.sections.insert(0, {"name": "core", "content": full_core, "tokens": full_tokens, "priority": 1000})
            self.core_mode = "full"
            return "full"

        if condensed_core:
            condensed_tokens = count_tokens_approx(condensed_core)
            self.core_tokens = condensed_tokens
            self.sections.insert(0, {"name": "core", "content": condensed_core, "tokens": condensed_tokens, "priority": 1000})
            self.core_mode = "condensed"
            return "condensed"

        # No condensed available, use full anyway
        self.core_tokens = full_tokens
        self.sections.insert(0, {"name": "core", "content": full_core, "tokens": full_tokens, "priority": 1000})
        self.core_mode = "full"
        return "full"

    def add_section(self, name: str, content: str, priority: int = 50):
        tokens = count_tokens_approx(content)
        self.sections.append({"name": name, "content": content, "tokens": tokens, "priority": priority})

    def fits(self) -> bool:
        total = sum(s["tokens"] for s in self.sections)
        return total <= self.available + self.core_tokens  # core already counted separately

    def remaining(self) -> int:
        used = sum(s["tokens"] for s in self.sections)
        return self.model_context_limit - self.response_reserve - self.history_reserve - used

    def compile(self) -> dict:
        """Compile sections, trimming lowest-priority sections if over budget."""
        budget = self.model_context_limit - self.response_reserve - self.history_reserve

        # Sort by priority descending — highest priority kept first
        sorted_sections = sorted(self.sections, key=lambda s: s["priority"], reverse=True)

        included = []
        total_tokens = 0
        trimmed = []

        for section in sorted_sections:
            if total_tokens + section["tokens"] <= budget:
                included.append(section)
                total_tokens += section["tokens"]
            else:
                trimmed.append(section["name"])

        # Re-sort included by original insertion order for deterministic output
        original_order = {s["name"]: i for i, s in enumerate(self.sections)}
        included.sort(key=lambda s: original_order.get(s["name"], 999))

        return {
            "system_prompt": "\n\n---\n\n".join(s["content"] for s in included),
            "included": [s["name"] for s in included],
            "trimmed": trimmed,
            "total_tokens": total_tokens,
            "budget": budget,
            "remaining": budget - total_tokens,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_budget.py -v
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: token budget manager with priority-based trimming"
```

---

### Task 10: Prompt Compiler (Assembly)

**Files:**
- Create: `promptbase/backend/app/compiler/compiler.py`
- Create: `promptbase/backend/tests/test_compiler.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/test_compiler.py`:

```python
import pytest

from app.compiler.compiler import PromptCompiler


@pytest.fixture
def sample_modules():
    return [
        {"name": "identity", "layer": "core", "content": "You are a first-principles analyst.", "tags": [], "priority": 100, "sort_order": 0},
        {"name": "reasoning", "layer": "core", "content": "Apply structured reasoning.", "tags": [], "priority": 100, "sort_order": 1},
        {"name": "execution", "layer": "core", "content": "Follow execution doctrine.", "tags": [], "priority": 100, "sort_order": 2},
        {"name": "output", "layer": "core", "content": "Format output clearly.", "tags": [], "priority": 100, "sort_order": 3},
        {"name": "org_map", "layer": "always", "content": "Organizational capability map.", "tags": [], "priority": 90, "sort_order": 16},
        {"name": "embedded_iot", "layer": "domain", "content": "Embedded IoT framework.", "tags": ["plc", "firmware", "sensor"], "priority": 50, "sort_order": 17},
        {"name": "business_apps", "layer": "domain", "content": "Business application suite.", "tags": ["erp", "crm", "warehouse"], "priority": 50, "sort_order": 18},
        {"name": "ai_ops", "layer": "domain", "content": "AI/ML/LLMOps framework.", "tags": ["llm", "agent", "rag"], "priority": 50, "sort_order": 19},
    ]


@pytest.fixture
def sample_modes():
    return [
        {"name": "analysis", "prompt_text": "Focus on objective analysis, gaps, risks."},
        {"name": "implementation", "prompt_text": "Produce concrete steps, APIs, schemas."},
    ]


def test_compile_loads_core_and_always(sample_modules, sample_modes):
    compiler = PromptCompiler(
        modules=sample_modules,
        modes=sample_modes,
        model_context_limit=128000,
        condensed_core=None,
    )
    result = compiler.compile(user_text="Hello", mode=None, doc_context="")

    assert "identity" in result["modules_loaded"]
    assert "reasoning" in result["modules_loaded"]
    assert "execution" in result["modules_loaded"]
    assert "output" in result["modules_loaded"]
    assert "org_map" in result["modules_loaded"]
    assert "embedded_iot" not in result["modules_loaded"]


def test_compile_loads_matching_domain(sample_modules, sample_modes):
    compiler = PromptCompiler(
        modules=sample_modules,
        modes=sample_modes,
        model_context_limit=128000,
        condensed_core=None,
    )
    result = compiler.compile(user_text="Configure the PLC sensor array", mode=None, doc_context="")

    assert "embedded_iot" in result["modules_loaded"]
    assert "business_apps" not in result["modules_loaded"]


def test_compile_with_mode(sample_modules, sample_modes):
    compiler = PromptCompiler(
        modules=sample_modules,
        modes=sample_modes,
        model_context_limit=128000,
        condensed_core=None,
    )
    result = compiler.compile(user_text="Review this", mode="analysis", doc_context="")

    assert "Focus on objective analysis" in result["system_prompt"]


def test_compile_with_doc_context(sample_modules, sample_modes):
    compiler = PromptCompiler(
        modules=sample_modules,
        modes=sample_modes,
        model_context_limit=128000,
        condensed_core=None,
    )
    result = compiler.compile(user_text="Summarize this", mode=None, doc_context="Document content here.")

    assert "Document content here." in result["system_prompt"]


def test_compile_includes_safety_wrapper(sample_modules, sample_modes):
    compiler = PromptCompiler(
        modules=sample_modules,
        modes=sample_modes,
        model_context_limit=128000,
        condensed_core=None,
    )
    result = compiler.compile(user_text="Hello", mode=None, doc_context="")

    assert "operating rules" in result["system_prompt"].lower() or "prompt pack" in result["system_prompt"].lower()


def test_compile_returns_debug_info(sample_modules, sample_modes):
    compiler = PromptCompiler(
        modules=sample_modules,
        modes=sample_modes,
        model_context_limit=128000,
        condensed_core=None,
    )
    result = compiler.compile(user_text="Hello", mode=None, doc_context="")

    assert "total_tokens" in result
    assert "modules_loaded" in result
    assert "system_prompt" in result
    assert isinstance(result["total_tokens"], int)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_compiler.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement prompt compiler**

Write `promptbase/backend/app/compiler/compiler.py`:

```python
from app.compiler.budget import TokenBudget, count_tokens_approx
from app.compiler.classifier import classify_request, detect_mode

SAFETY_WRAPPER = """You are operating using a managed prompt pack.
Apply the loaded instructions as operating rules.
Prefer the most specific applicable rule.
If rules conflict: 1) safety and correctness, 2) explicit task constraints, 3) domain-specific modules, 4) general framework rules.
State assumptions clearly. Do not invent missing facts."""


class PromptCompiler:
    def __init__(
        self,
        modules: list[dict],
        modes: list[dict],
        model_context_limit: int,
        condensed_core: str | None,
    ):
        self.modules = sorted(modules, key=lambda m: m["sort_order"])
        self.modes = {m["name"]: m["prompt_text"] for m in modes}
        self.model_context_limit = model_context_limit
        self.condensed_core = condensed_core

    def compile(
        self,
        user_text: str,
        mode: str | None,
        doc_context: str,
        history_tokens: int = 0,
    ) -> dict:
        budget = TokenBudget(model_context_limit=self.model_context_limit)
        budget.reserve_for_response(4096)
        budget.reserve_for_history(history_tokens)

        # 1. Classify request
        matched_domains = classify_request(user_text)
        detected_mode = mode or detect_mode(user_text)

        # 2. Collect sections by layer
        core_parts = []
        always_parts = []
        domain_parts = []
        modules_loaded = []

        for mod in self.modules:
            if mod["layer"] == "core":
                core_parts.append(mod["content"])
                modules_loaded.append(mod["name"])
            elif mod["layer"] == "always":
                always_parts.append(mod["content"])
                modules_loaded.append(mod["name"])
            elif mod["layer"] == "domain":
                # Check if any of this module's tags matched
                mod_tags = set(t.lower() for t in mod.get("tags", []))
                user_lower = user_text.lower()
                if any(tag in user_lower for tag in mod_tags):
                    domain_parts.append(mod["content"])
                    modules_loaded.append(mod["name"])

        # 3. Build budget sections
        full_core = "\n\n".join(core_parts)
        budget.add_core_with_fallback(full_core, self.condensed_core)

        # Always-append
        if always_parts:
            always_text = "\n\n".join(always_parts)
            budget.add_section("always", always_text, priority=90)

        # Domain modules
        for i, content in enumerate(domain_parts):
            budget.add_section(f"domain_{i}", content, priority=50)

        # Mode prompt
        mode_text = ""
        if detected_mode and detected_mode in self.modes:
            mode_text = self.modes[detected_mode]
            budget.add_section("mode", mode_text, priority=70)

        # Document context
        if doc_context:
            budget.add_section("documents", f"## Reference Documents\n\n{doc_context}", priority=30)

        # 4. Compile with budget enforcement
        result = budget.compile()

        # 5. Prepend safety wrapper
        system_prompt = SAFETY_WRAPPER + "\n\n---\n\n" + result["system_prompt"]

        return {
            "system_prompt": system_prompt,
            "total_tokens": result["total_tokens"] + count_tokens_approx(SAFETY_WRAPPER),
            "modules_loaded": modules_loaded,
            "domains_matched": list(matched_domains),
            "mode": detected_mode,
            "trimmed": result["trimmed"],
            "budget_remaining": result["remaining"],
            "core_mode": budget.core_mode,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_compiler.py -v
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: prompt compiler with layered assembly and budget enforcement"
```

---

## Phase 4: LLM Provider Layer

### Task 11: Provider Base & Registry

**Files:**
- Create: `promptbase/backend/app/providers/__init__.py`
- Create: `promptbase/backend/app/providers/base.py`
- Create: `promptbase/backend/app/providers/registry.py`
- Create: `promptbase/backend/tests/test_providers.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/test_providers.py`:

```python
import pytest

from app.providers.base import LLMProvider
from app.providers.registry import get_provider


def test_base_provider_is_abstract():
    with pytest.raises(TypeError):
        LLMProvider()


def test_registry_returns_none_for_unknown():
    provider = get_provider("nonexistent")
    assert provider is None


def test_registry_returns_anthropic():
    provider = get_provider("anthropic")
    assert provider is not None
    assert isinstance(provider, LLMProvider)


def test_registry_returns_openai():
    provider = get_provider("openai")
    assert provider is not None


def test_registry_returns_openrouter():
    provider = get_provider("openrouter")
    assert provider is not None


def test_registry_returns_ollama():
    provider = get_provider("ollama")
    assert provider is not None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_providers.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement base provider**

Write `promptbase/backend/app/providers/__init__.py`:

```python
```

Write `promptbase/backend/app/providers/base.py`:

```python
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class LLMConfig:
    model: str
    api_key: str = ""
    base_url: str = ""
    temperature: float = 0.7
    max_tokens: int = 4096


class LLMProvider(ABC):
    @abstractmethod
    async def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict],
        config: LLMConfig,
    ) -> AsyncIterator[str]:
        yield ""

    @abstractmethod
    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        ...

    @abstractmethod
    def count_tokens(self, text: str) -> int:
        ...

    @abstractmethod
    def max_context_tokens(self, model: str) -> int:
        ...
```

- [ ] **Step 4: Implement Anthropic provider**

Write `promptbase/backend/app/providers/anthropic.py`:

```python
from collections.abc import AsyncIterator

import anthropic

from app.providers.base import LLMConfig, LLMProvider

MODEL_CONTEXT = {
    "claude-sonnet-4-20250514": 200000,
    "claude-opus-4-20250514": 200000,
    "claude-haiku-4-20250414": 200000,
}


class AnthropicProvider(LLMProvider):
    async def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict],
        config: LLMConfig,
    ) -> AsyncIterator[str]:
        client = anthropic.AsyncAnthropic(api_key=config.api_key)
        async with client.messages.stream(
            model=config.model,
            max_tokens=config.max_tokens,
            system=system_prompt,
            messages=messages,
            temperature=config.temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        # Anthropic doesn't have a native embedding API yet.
        # Use Voyage AI or fall back to another provider.
        raise NotImplementedError("Use OpenAI or Voyage for embeddings with Anthropic")

    def count_tokens(self, text: str) -> int:
        # Rough estimate — Anthropic's tokenizer is similar to ~4 chars/token
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return MODEL_CONTEXT.get(model, 200000)
```

- [ ] **Step 5: Implement OpenAI provider**

Write `promptbase/backend/app/providers/openai_provider.py`:

```python
from collections.abc import AsyncIterator

import openai
import tiktoken

from app.providers.base import LLMConfig, LLMProvider

MODEL_CONTEXT = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
}


class OpenAIProvider(LLMProvider):
    async def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict],
        config: LLMConfig,
    ) -> AsyncIterator[str]:
        client = openai.AsyncOpenAI(api_key=config.api_key)
        full_messages = [{"role": "system", "content": system_prompt}] + messages
        stream = await client.chat.completions.create(
            model=config.model,
            messages=full_messages,
            temperature=config.temperature,
            max_tokens=config.max_tokens,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        client = openai.AsyncOpenAI(api_key=config.api_key)
        response = await client.embeddings.create(
            model=config.model,
            input=texts,
        )
        return [item.embedding for item in response.data]

    def count_tokens(self, text: str) -> int:
        try:
            enc = tiktoken.encoding_for_model("gpt-4o")
            return len(enc.encode(text))
        except Exception:
            return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return MODEL_CONTEXT.get(model, 128000)
```

- [ ] **Step 6: Implement OpenRouter provider**

Write `promptbase/backend/app/providers/openrouter.py`:

```python
from collections.abc import AsyncIterator

import httpx

from app.providers.base import LLMConfig, LLMProvider


class OpenRouterProvider(LLMProvider):
    BASE_URL = "https://openrouter.ai/api/v1"

    async def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict],
        config: LLMConfig,
    ) -> AsyncIterator[str]:
        base_url = config.base_url or self.BASE_URL
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.model,
                    "messages": full_messages,
                    "temperature": config.temperature,
                    "max_tokens": config.max_tokens,
                    "stream": True,
                },
                timeout=120.0,
            ) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        import json
                        try:
                            chunk = json.loads(data)
                            content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        base_url = config.base_url or self.BASE_URL
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/embeddings",
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={"model": config.model, "input": texts},
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return 128000  # Varies by model — can be extended with a lookup
```

- [ ] **Step 7: Implement Ollama provider**

Write `promptbase/backend/app/providers/ollama.py`:

```python
import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import LLMConfig, LLMProvider

MODEL_CONTEXT = {
    "llama3": 8192,
    "llama3:70b": 8192,
    "mixtral": 32768,
    "codellama": 16384,
    "deepseek-coder": 16384,
}


class OllamaProvider(LLMProvider):
    async def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict],
        config: LLMConfig,
    ) -> AsyncIterator[str]:
        base_url = config.base_url or "http://localhost:11434"
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{base_url}/api/chat",
                json={
                    "model": config.model,
                    "messages": full_messages,
                    "stream": True,
                    "options": {
                        "temperature": config.temperature,
                        "num_predict": config.max_tokens,
                    },
                },
                timeout=120.0,
            ) as response:
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        content = chunk.get("message", {}).get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    async def embed(self, texts: list[str], config: LLMConfig) -> list[list[float]]:
        base_url = config.base_url or "http://localhost:11434"
        embeddings = []
        async with httpx.AsyncClient() as client:
            for text in texts:
                response = await client.post(
                    f"{base_url}/api/embeddings",
                    json={"model": config.model, "prompt": text},
                    timeout=60.0,
                )
                response.raise_for_status()
                data = response.json()
                embeddings.append(data["embedding"])
        return embeddings

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def max_context_tokens(self, model: str) -> int:
        return MODEL_CONTEXT.get(model, 8192)
```

- [ ] **Step 8: Implement registry**

Write `promptbase/backend/app/providers/registry.py`:

```python
from app.providers.anthropic import AnthropicProvider
from app.providers.base import LLMProvider
from app.providers.ollama import OllamaProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.openrouter import OpenRouterProvider

_PROVIDERS: dict[str, type[LLMProvider]] = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "openrouter": OpenRouterProvider,
    "ollama": OllamaProvider,
}


def get_provider(name: str) -> LLMProvider | None:
    cls = _PROVIDERS.get(name)
    if cls is None:
        return None
    return cls()


def list_providers() -> list[str]:
    return list(_PROVIDERS.keys())
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_providers.py -v
```

Expected: All tests PASS.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: LLM provider layer with Anthropic, OpenAI, OpenRouter, Ollama"
```

---

## Phase 5: Document Pipeline

### Task 12: Document Models & Migration

**Files:**
- Create: `promptbase/backend/app/documents/__init__.py`
- Create: `promptbase/backend/app/documents/models.py`
- Create: `promptbase/backend/app/documents/schemas.py`

- [ ] **Step 1: Create document models**

Write `promptbase/backend/app/documents/__init__.py`:

```python
```

Write `promptbase/backend/app/documents/models.py`:

```python
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    filename: Mapped[str] = mapped_column(String(500))
    file_path: Mapped[str] = mapped_column(String(1000))
    file_type: Mapped[str] = mapped_column(String(50))
    file_size: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|processing|ready|failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(20), nullable=True)  # full_inject|rag
    full_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"))
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)

    document: Mapped["Document"] = relationship(back_populates="chunks")
```

- [ ] **Step 2: Create document schemas**

Write `promptbase/backend/app/documents/schemas.py`:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    file_size: int
    status: str
    strategy: str | None
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
```

- [ ] **Step 3: Generate migration**

Add to `promptbase/backend/alembic/env.py`:

```python
from app.documents.models import Document, DocumentChunk  # noqa: F401
```

```bash
cd promptbase/backend
alembic revision --autogenerate -m "document tables"
alembic upgrade head
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: document models with pgvector embeddings"
```

---

### Task 13: Document Parser

**Files:**
- Create: `promptbase/backend/app/documents/parser.py`
- Create: `promptbase/backend/tests/test_parser.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/test_parser.py`:

```python
import tempfile
from pathlib import Path

from app.documents.parser import parse_document


def test_parse_txt():
    with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", delete=False) as f:
        f.write("Hello world, this is a test document.")
        f.flush()
        result = parse_document(f.name, "text/plain")
    assert "Hello world" in result


def test_parse_csv():
    with tempfile.NamedTemporaryFile(suffix=".csv", mode="w", delete=False) as f:
        f.write("name,value\nfoo,1\nbar,2\n")
        f.flush()
        result = parse_document(f.name, "text/csv")
    assert "foo" in result
    assert "bar" in result


def test_parse_unknown_type_raises():
    import pytest
    with pytest.raises(ValueError, match="Unsupported"):
        parse_document("/tmp/fake.xyz", "application/xyz")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_parser.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement parser**

Write `promptbase/backend/app/documents/parser.py`:

```python
from pathlib import Path

import httpx

from app.config import settings


def parse_document(file_path: str, content_type: str) -> str:
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix in (".txt", ".md") or content_type in ("text/plain", "text/markdown"):
        return path.read_text(encoding="utf-8")

    if suffix == ".csv" or content_type == "text/csv":
        return path.read_text(encoding="utf-8")

    if suffix == ".pdf" or content_type == "application/pdf":
        return _parse_pdf(file_path)

    if suffix == ".docx" or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _parse_docx(file_path)

    if suffix in (".png", ".jpg", ".jpeg", ".tiff", ".bmp"):
        return _parse_image_ocr(file_path)

    raise ValueError(f"Unsupported file type: {suffix} ({content_type})")


def _parse_pdf(file_path: str) -> str:
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)
    text_parts = []
    for page in doc:
        text = page.get_text()
        if text.strip():
            text_parts.append(text)

    full_text = "\n\n".join(text_parts)

    # If very little text extracted, it might be scanned — try OCR
    if len(full_text.strip()) < 100 and settings.ocr_service_url:
        return _parse_image_ocr(file_path)

    return full_text


def _parse_docx(file_path: str) -> str:
    import docx

    doc = docx.Document(file_path)
    parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)

    # Also extract tables
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            parts.append(" | ".join(cells))

    return "\n\n".join(parts)


def _parse_image_ocr(file_path: str) -> str:
    if not settings.ocr_service_url:
        raise ValueError("OCR service URL not configured. Cannot process image/scanned documents.")

    with open(file_path, "rb") as f:
        response = httpx.post(
            settings.ocr_service_url,
            files={"file": (Path(file_path).name, f)},
            timeout=120.0,
        )
    response.raise_for_status()
    return response.json().get("text", "")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_parser.py -v
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: document parser for PDF, DOCX, TXT, CSV, images"
```

---

### Task 14: Chunker & Retriever

**Files:**
- Create: `promptbase/backend/app/documents/chunker.py`
- Create: `promptbase/backend/app/documents/retriever.py`
- Create: `promptbase/backend/tests/test_chunker.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/test_chunker.py`:

```python
from app.documents.chunker import chunk_text


def test_chunk_text_basic():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunks = chunk_text(text, chunk_size=20, overlap=5)
    assert len(chunks) >= 2
    assert all(isinstance(c, str) for c in chunks)
    assert all(len(c) > 0 for c in chunks)


def test_chunk_text_small_fits_one():
    text = "Short text."
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) == 1
    assert chunks[0] == "Short text."


def test_chunk_text_preserves_content():
    text = "Word " * 200  # 1000 chars
    chunks = chunk_text(text, chunk_size=200, overlap=50)
    reassembled = " ".join(chunks)
    # All original words should appear
    assert reassembled.count("Word") >= 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_chunker.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement chunker**

Write `promptbase/backend/app/documents/chunker.py`:

```python
from app.compiler.budget import count_tokens_approx


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into chunks of approximately chunk_size characters with overlap.
    Tries to split on paragraph boundaries first, then sentences, then hard split."""

    if len(text) <= chunk_size:
        return [text]

    # Split on double newlines (paragraphs)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks = []
    current_chunk = ""

    for para in paragraphs:
        if len(current_chunk) + len(para) + 2 <= chunk_size:
            current_chunk = (current_chunk + "\n\n" + para).strip()
        else:
            if current_chunk:
                chunks.append(current_chunk)
            # If single paragraph is larger than chunk_size, split it further
            if len(para) > chunk_size:
                sub_chunks = _hard_split(para, chunk_size, overlap)
                chunks.extend(sub_chunks)
                current_chunk = ""
            else:
                # Start new chunk with overlap
                if chunks:
                    overlap_text = current_chunk[-overlap:] if len(current_chunk) > overlap else ""
                    current_chunk = (overlap_text + " " + para).strip()
                else:
                    current_chunk = para

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def _hard_split(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Hard split long text into chunks with overlap."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk.strip())
        start = end - overlap
    return [c for c in chunks if c]


def count_chunk_tokens(chunks: list[str]) -> list[int]:
    return [count_tokens_approx(c) for c in chunks]
```

- [ ] **Step 4: Implement retriever**

Write `promptbase/backend/app/documents/retriever.py`:

```python
import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.documents.models import Document, DocumentChunk


async def retrieve_document_context(
    db: AsyncSession,
    document_ids: list[uuid.UUID],
    query_embedding: list[float] | None,
    top_k: int = 5,
) -> str:
    """Retrieve document context for chat. Full inject for small docs, RAG for large."""
    parts = []

    for doc_id in document_ids:
        result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = result.scalar_one_or_none()
        if not doc or doc.status != "ready":
            continue

        if doc.strategy == "full_inject" and doc.full_text:
            parts.append(f"### {doc.filename}\n\n{doc.full_text}")
        elif doc.strategy == "rag" and query_embedding:
            # Vector similarity search
            chunk_results = await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == doc_id)
                .where(DocumentChunk.embedding.isnot(None))
                .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
                .limit(top_k)
            )
            chunks = chunk_results.scalars().all()
            if chunks:
                chunk_texts = [f"[Chunk {c.chunk_index}] {c.content}" for c in chunks]
                parts.append(f"### {doc.filename} (relevant sections)\n\n" + "\n\n".join(chunk_texts))

    return "\n\n---\n\n".join(parts)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_chunker.py -v
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: document chunker and pgvector retriever"
```

---

### Task 15: Document Worker Task & Routes

**Files:**
- Modify: `promptbase/backend/app/workers/tasks.py`
- Create: `promptbase/backend/app/documents/routes.py`
- Modify: `promptbase/backend/app/main.py`

- [ ] **Step 1: Implement document processing worker task**

Replace `promptbase/backend/app/workers/tasks.py`:

```python
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.documents.chunker import chunk_text, count_chunk_tokens
from app.documents.models import Document, DocumentChunk
from app.documents.parser import parse_document
from app.compiler.budget import count_tokens_approx
from app.workers.celery_app import celery


def _get_sync_session():
    """Create a synchronous session for Celery tasks."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    # Convert async URL to sync
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg2").replace("postgresql+psycopg2", "postgresql")
    if "postgresql://" not in sync_url:
        sync_url = settings.database_url.replace("postgresql+asyncpg", "postgresql")
    engine = create_engine(sync_url)
    return Session(engine)


@celery.task(name="process_document", bind=True, max_retries=3)
def process_document(self, document_id: str):
    session = _get_sync_session()
    try:
        doc = session.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
        if not doc:
            return

        doc.status = "processing"
        session.commit()

        # 1. Parse
        text = parse_document(doc.file_path, doc.file_type)

        # 2. Count tokens
        token_count = count_tokens_approx(text)
        doc.token_count = token_count

        # 3. Decide strategy
        if token_count <= settings.rag_threshold_tokens:
            doc.strategy = "full_inject"
            doc.full_text = text
            doc.status = "ready"
            session.commit()
            return

        # 4. RAG strategy — chunk
        doc.strategy = "rag"
        chunks = chunk_text(text, chunk_size=settings.default_chunk_size * 4, overlap=settings.default_chunk_overlap * 4)
        token_counts = count_chunk_tokens(chunks)

        for i, (chunk_text_content, tokens) in enumerate(zip(chunks, token_counts)):
            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text_content,
                token_count=tokens,
                embedding=None,  # Embeddings added in a follow-up step
            )
            session.add(chunk)

        doc.status = "ready"
        session.commit()

    except Exception as e:
        session.rollback()
        doc = session.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
        if doc:
            doc.status = "failed"
            doc.error_message = str(e)[:1000]
            session.commit()
        raise self.retry(exc=e, countdown=60)
    finally:
        session.close()
```

- [ ] **Step 2: Create document routes**

Write `promptbase/backend/app/documents/routes.py`:

```python
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.auth.service import get_user_team_role
from app.config import settings
from app.database import get_db
from app.documents.models import Document
from app.documents.schemas import DocumentListResponse, DocumentResponse
from app.workers.tasks import process_document

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/{team_id}/upload", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    team_id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this team")

    # Check file size
    contents = await file.read()
    if len(contents) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    # Save file
    upload_dir = Path(settings.upload_dir) / str(team_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{uuid.uuid4()}_{file.filename}"
    file_path.write_bytes(contents)

    # Create record
    doc = Document(
        team_id=team_id,
        user_id=user.id,
        filename=file.filename,
        file_path=str(file_path),
        file_type=file.content_type or "application/octet-stream",
        file_size=len(contents),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Dispatch worker
    process_document.delay(str(doc.id))

    return doc


@router.get("/{team_id}", response_model=DocumentListResponse)
async def list_documents(
    team_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(
        select(Document).where(Document.team_id == team_id).order_by(Document.created_at.desc())
    )
    return DocumentListResponse(documents=result.scalars().all())


@router.get("/{team_id}/{document_id}", response_model=DocumentResponse)
async def get_document(
    team_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.team_id == team_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return doc


@router.delete("/{team_id}/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    team_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role not in ("admin",) and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Team admin required")

    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.team_id == team_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Delete file
    file_path = Path(doc.file_path)
    if file_path.exists():
        file_path.unlink()

    await db.delete(doc)
    await db.commit()
```

- [ ] **Step 3: Register document router in main.py**

In `promptbase/backend/app/main.py`, add:

```python
from app.documents.routes import router as documents_router

app.include_router(documents_router)
```

- [ ] **Step 4: Add psycopg2 to dependencies**

In `promptbase/backend/pyproject.toml`, add to dependencies:

```
"psycopg2-binary>=2.9.0",
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: document upload, processing worker, and routes"
```

---

## Phase 6: Chat Module

### Task 16: Chat Models & Migration

**Files:**
- Create: `promptbase/backend/app/chat/__init__.py`
- Create: `promptbase/backend/app/chat/models.py`
- Create: `promptbase/backend/app/chat/schemas.py`

- [ ] **Step 1: Create chat models**

Write `promptbase/backend/app/chat/__init__.py`:

```python
```

Write `promptbase/backend/app/chat/models.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(500), default="New conversation")
    mode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id"))
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class ConversationDocument(Base):
    __tablename__ = "conversation_documents"

    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id"), primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), primary_key=True)
```

- [ ] **Step 2: Create chat schemas**

Write `promptbase/backend/app/chat/schemas.py`:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    conversation_id: uuid.UUID | None = None
    team_id: uuid.UUID
    document_ids: list[uuid.UUID] = []
    mode: str | None = None


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    token_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    mode: str | None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ConversationListResponse(BaseModel):
    conversations: list[ConversationResponse]
```

- [ ] **Step 3: Generate migration**

Add to `promptbase/backend/alembic/env.py`:

```python
from app.chat.models import Conversation, Message, ConversationDocument  # noqa: F401
```

```bash
cd promptbase/backend
alembic revision --autogenerate -m "chat tables"
alembic upgrade head
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: chat models for conversations and messages"
```

---

### Task 17: Chat Service & SSE Streaming

**Files:**
- Create: `promptbase/backend/app/chat/service.py`
- Create: `promptbase/backend/app/chat/routes.py`
- Modify: `promptbase/backend/app/main.py`

- [ ] **Step 1: Implement chat service**

Write `promptbase/backend/app/chat/service.py`:

```python
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

    # Trim from oldest, keep within budget
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
            "name": m.title,
            "layer": m.layer,
            "content": m.content,
            "tags": m.tags or [],
            "priority": m.priority,
            "sort_order": m.sort_order,
        }
        for m in modules_result.scalars().all()
    ]

    modes_result = await db.execute(
        select(TaskMode).where(TaskMode.pack_id == pack.id)
    )
    modes = [
        {"name": m.name, "prompt_text": m.prompt_text}
        for m in modes_result.scalars().all()
    ]

    return {
        "modules": modules,
        "modes": modes,
        "condensed_core": pack.condensed_core,
    }


async def stream_chat_response(
    db: AsyncSession,
    conversation: Conversation,
    user_message: str,
    document_ids: list[uuid.UUID],
    provider_name: str,
    llm_config: LLMConfig,
) -> AsyncIterator[str]:
    # 1. Save user message
    user_msg = Message(
        conversation_id=conversation.id,
        role="user",
        content=user_message,
        token_count=count_tokens_approx(user_message),
    )
    db.add(user_msg)
    await db.flush()

    # 2. Auto-title from first message
    if conversation.title == "New conversation":
        conversation.title = user_message[:100]
        await db.flush()

    # 3. Load pack
    pack_data = await load_pack_for_team(db, conversation.team_id)

    # 4. Build system prompt
    if pack_data:
        compiler = PromptCompiler(
            modules=pack_data["modules"],
            modes=pack_data["modes"],
            model_context_limit=llm_config.max_tokens * 10,  # rough context estimate
            condensed_core=pack_data["condensed_core"],
        )
    else:
        compiler = PromptCompiler(modules=[], modes=[], model_context_limit=128000, condensed_core=None)

    # 5. Retrieve document context
    doc_context = ""
    if document_ids:
        doc_context = await retrieve_document_context(db, document_ids, query_embedding=None)

    # 6. Load history
    history = await load_conversation_history(db, conversation.id, max_tokens=8000)

    # 7. Compile prompt
    compiled = compiler.compile(
        user_text=user_message,
        mode=conversation.mode,
        doc_context=doc_context,
        history_tokens=sum(count_tokens_approx(m["content"]) for m in history),
    )

    # 8. Stream from provider
    provider = get_provider(provider_name)
    if not provider:
        yield f"Error: Provider '{provider_name}' not found"
        return

    messages = history + [{"role": "user", "content": user_message}]
    full_response = ""

    async for token in provider.stream_chat(compiled["system_prompt"], messages, llm_config):
        full_response += token
        yield token

    # 9. Save assistant message
    assistant_msg = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=full_response,
        token_count=count_tokens_approx(full_response),
    )
    db.add(assistant_msg)
    await db.commit()
```

- [ ] **Step 2: Create chat routes with SSE**

Write `promptbase/backend/app/chat/routes.py`:

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
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
    # For now, use defaults
    llm_config = LLMConfig(
        model="claude-sonnet-4-20250514",
        api_key="",  # Will come from team config
        temperature=0.7,
        max_tokens=4096,
    )

    async def event_stream():
        yield f"data: {{\"conversation_id\": \"{conversation.id}\"}}\n\n"
        async for token in stream_chat_response(
            db, conversation, body.message, body.document_ids,
            provider_name="anthropic",  # Will come from team config
            llm_config=llm_config,
        ):
            # Escape for SSE
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
    team_id: uuid.UUID,
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
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
```

- [ ] **Step 3: Register chat router in main.py**

In `promptbase/backend/app/main.py`, add:

```python
from app.chat.routes import router as chat_router

app.include_router(chat_router)
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: chat service with SSE streaming and conversation management"
```

---

## Phase 7: Export Pipeline

### Task 18: Markdown to Word Renderer

**Files:**
- Create: `promptbase/backend/app/export/__init__.py`
- Create: `promptbase/backend/app/export/renderer.py`
- Create: `promptbase/backend/tests/test_export.py`

- [ ] **Step 1: Write the failing test**

Write `promptbase/backend/tests/test_export.py`:

```python
import tempfile
from pathlib import Path

from app.export.renderer import render_markdown_to_docx


def test_render_headings():
    md = "# Title\n\n## Subtitle\n\n### Section\n\nParagraph text."
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        render_markdown_to_docx(md, f.name)
        path = Path(f.name)
    assert path.exists()
    assert path.stat().st_size > 0

    # Verify content via python-docx
    import docx
    doc = docx.Document(f.name)
    styles = [p.style.name for p in doc.paragraphs]
    assert "Heading 1" in styles
    assert "Heading 2" in styles


def test_render_table():
    md = "| Name | Value |\n|------|-------|\n| Foo | 1 |\n| Bar | 2 |"
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        render_markdown_to_docx(md, f.name)

    import docx
    doc = docx.Document(f.name)
    assert len(doc.tables) == 1
    assert doc.tables[0].rows[0].cells[0].text == "Name"


def test_render_bold_italic():
    md = "This is **bold** and *italic* text."
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        render_markdown_to_docx(md, f.name)

    import docx
    doc = docx.Document(f.name)
    runs = doc.paragraphs[0].runs
    bold_found = any(r.bold for r in runs)
    italic_found = any(r.italic for r in runs)
    assert bold_found
    assert italic_found


def test_render_bullet_list():
    md = "- Item one\n- Item two\n- Item three"
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        render_markdown_to_docx(md, f.name)

    import docx
    doc = docx.Document(f.name)
    list_items = [p for p in doc.paragraphs if "List" in (p.style.name or "")]
    assert len(list_items) >= 3


def test_render_code_block():
    md = "```python\ndef hello():\n    print('hi')\n```"
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        render_markdown_to_docx(md, f.name)

    import docx
    doc = docx.Document(f.name)
    # Code should be in a paragraph with monospace font
    found_code = any("hello" in p.text for p in doc.paragraphs)
    assert found_code


def test_render_with_template():
    md = "# Test\n\nContent here."
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        render_markdown_to_docx(md, f.name, template_path=None)
    assert Path(f.name).stat().st_size > 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd promptbase/backend
pytest tests/test_export.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement renderer**

Write `promptbase/backend/app/export/__init__.py`:

```python
```

Write `promptbase/backend/app/export/renderer.py`:

```python
from pathlib import Path

import mistune
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor
from docx.oxml.ns import qn


def render_markdown_to_docx(
    markdown_text: str,
    output_path: str,
    template_path: str | None = None,
    title: str | None = None,
    metadata: dict | None = None,
):
    """Convert markdown text to a structured Word document."""
    if template_path and Path(template_path).exists():
        doc = Document(template_path)
    else:
        doc = Document()

    # Parse markdown to AST
    md = mistune.create_markdown(renderer=mistune.AstRenderer())
    tokens = md(markdown_text)

    # Add metadata header if provided
    if metadata:
        meta_para = doc.add_paragraph()
        meta_para.style = doc.styles["Normal"]
        for key, value in metadata.items():
            run = meta_para.add_run(f"{key}: {value}\n")
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(128, 128, 128)

    # Walk AST and render
    for token in tokens:
        _render_token(doc, token)

    doc.save(output_path)


def _render_token(doc: Document, token: dict):
    token_type = token.get("type", "")

    if token_type == "heading":
        level = token.get("attrs", {}).get("level", 1)
        text = _extract_text(token.get("children", []))
        doc.add_heading(text, level=min(level, 3))

    elif token_type == "paragraph":
        para = doc.add_paragraph()
        _render_inline(para, token.get("children", []))

    elif token_type == "list":
        ordered = token.get("attrs", {}).get("ordered", False)
        for item in token.get("children", []):
            if item.get("type") == "list_item":
                para = doc.add_paragraph(style="List Number" if ordered else "List Bullet")
                children = item.get("children", [])
                for child in children:
                    if child.get("type") == "paragraph":
                        _render_inline(para, child.get("children", []))

    elif token_type == "table":
        _render_table(doc, token)

    elif token_type == "block_code":
        code = token.get("raw", token.get("text", ""))
        para = doc.add_paragraph()
        run = para.add_run(code)
        run.font.name = "Courier New"
        run.font.size = Pt(9)
        # Add shading
        shading = run._element.get_or_add_rPr()
        shd = shading.makeelement(qn("w:shd"), {
            qn("w:val"): "clear",
            qn("w:fill"): "F0F0F0",
        })
        shading.append(shd)

    elif token_type == "thematic_break":
        doc.add_paragraph("─" * 50)


def _render_inline(para, children: list):
    for child in children:
        child_type = child.get("type", "")

        if child_type == "text":
            para.add_run(child.get("raw", child.get("text", "")))

        elif child_type == "strong":
            text = _extract_text(child.get("children", []))
            run = para.add_run(text)
            run.bold = True

        elif child_type == "emphasis":
            text = _extract_text(child.get("children", []))
            run = para.add_run(text)
            run.italic = True

        elif child_type == "codespan":
            text = child.get("raw", child.get("text", ""))
            run = para.add_run(text)
            run.font.name = "Courier New"
            run.font.size = Pt(9)

        elif child_type == "link":
            text = _extract_text(child.get("children", []))
            para.add_run(text)

        elif child_type == "softbreak":
            para.add_run("\n")


def _extract_text(children: list) -> str:
    parts = []
    for child in children:
        if child.get("type") == "text":
            parts.append(child.get("raw", child.get("text", "")))
        elif "children" in child:
            parts.append(_extract_text(child["children"]))
        elif "raw" in child:
            parts.append(child["raw"])
    return "".join(parts)


def _render_table(doc: Document, token: dict):
    children = token.get("children", [])
    if not children:
        return

    # Collect all rows
    rows = []
    for child in children:
        if child.get("type") in ("table_head", "table_body"):
            for row in child.get("children", []):
                if row.get("type") == "table_row":
                    cells = []
                    for cell in row.get("children", []):
                        cells.append(_extract_text(cell.get("children", [])))
                    rows.append(cells)

    if not rows:
        return

    num_cols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=num_cols)
    table.style = "Table Grid"

    for i, row_data in enumerate(rows):
        for j, cell_text in enumerate(row_data):
            if j < num_cols:
                cell = table.rows[i].cells[j]
                cell.text = cell_text

                # Bold header row
                if i == 0:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.bold = True
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd promptbase/backend
pytest tests/test_export.py -v
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: markdown to Word document renderer with tables, lists, formatting"
```

---

### Task 19: Export Routes

**Files:**
- Create: `promptbase/backend/app/export/routes.py`
- Create: `promptbase/backend/app/export/pdf.py`
- Modify: `promptbase/backend/app/main.py`

- [ ] **Step 1: Create export routes**

Write `promptbase/backend/app/export/routes.py`:

```python
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.chat.models import Conversation, Message
from app.database import get_db
from app.export.renderer import render_markdown_to_docx

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/message/{message_id}")
async def export_message(
    message_id: uuid.UUID,
    format: str = "docx",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Message).where(Message.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Verify user owns the conversation
    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == msg.conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if not conv or conv.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    return await _export_markdown(msg.content, f"message_{message_id}", format, metadata={
        "Exported from": conv.title,
        "Role": msg.role,
    })


@router.get("/conversation/{conversation_id}")
async def export_conversation(
    conversation_id: uuid.UUID,
    format: str = "docx",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
        )
    )
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    messages_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    messages = messages_result.scalars().all()

    # Build combined markdown
    parts = [f"# {conv.title}\n"]
    for msg in messages:
        role_label = "**User:**" if msg.role == "user" else "**Assistant:**"
        parts.append(f"\n{role_label}\n\n{msg.content}")

    combined_md = "\n\n---\n\n".join(parts)

    return await _export_markdown(combined_md, f"conversation_{conversation_id}", format, metadata={
        "Conversation": conv.title,
        "Messages": str(len(messages)),
    })


async def _export_markdown(
    markdown: str,
    filename_base: str,
    format: str,
    metadata: dict | None = None,
    template_path: str | None = None,
) -> FileResponse:
    tmp = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    render_markdown_to_docx(markdown, tmp.name, template_path=template_path, metadata=metadata)

    if format == "pdf":
        from app.export.pdf import convert_to_pdf
        pdf_path = convert_to_pdf(tmp.name)
        if pdf_path:
            return FileResponse(
                pdf_path,
                media_type="application/pdf",
                filename=f"{filename_base}.pdf",
            )

    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{filename_base}.docx",
    )
```

- [ ] **Step 2: Create PDF converter**

Write `promptbase/backend/app/export/pdf.py`:

```python
import subprocess
import tempfile
from pathlib import Path


def convert_to_pdf(docx_path: str) -> str | None:
    """Convert DOCX to PDF using LibreOffice headless. Returns PDF path or None if unavailable."""
    try:
        output_dir = tempfile.mkdtemp()
        result = subprocess.run(
            [
                "libreoffice",
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                output_dir,
                docx_path,
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode == 0:
            pdf_name = Path(docx_path).stem + ".pdf"
            pdf_path = Path(output_dir) / pdf_name
            if pdf_path.exists():
                return str(pdf_path)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None
```

- [ ] **Step 3: Register export router in main.py**

In `promptbase/backend/app/main.py`, add:

```python
from app.export.routes import router as export_router

app.include_router(export_router)
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: export routes for messages and conversations to DOCX/PDF"
```

---

## Phase 8: Admin Module

### Task 20: Admin Routes (Pack CRUD & Import)

**Files:**
- Create: `promptbase/backend/app/admin/__init__.py`
- Create: `promptbase/backend/app/admin/routes.py`
- Create: `promptbase/backend/app/admin/importer.py`
- Modify: `promptbase/backend/app/main.py`

- [ ] **Step 1: Create pack importer**

Write `promptbase/backend/app/admin/__init__.py`:

```python
```

Write `promptbase/backend/app/admin/importer.py`:

```python
import io
import json
import re
import zipfile

from sqlalchemy.ext.asyncio import AsyncSession

from app.compiler.budget import count_tokens_approx
from app.compiler.models import PromptModule, PromptPack, TaskMode


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML-like frontmatter from markdown. Returns (metadata, body)."""
    if not content.startswith("---"):
        return {}, content

    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content

    meta_text = parts[1].strip()
    body = parts[2].strip()

    metadata = {}
    for line in meta_text.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()

            # Parse arrays
            if value.startswith("[") and value.endswith("]"):
                items = value[1:-1].split(",")
                value = [item.strip().strip("'\"") for item in items]

            # Parse booleans
            elif value.lower() in ("true", "false"):
                value = value.lower() == "true"

            # Parse numbers
            elif value.isdigit():
                value = int(value)

            metadata[key] = value

    return metadata, body


async def import_pack_from_zip(
    db: AsyncSession,
    zip_data: bytes,
    pack_name: str,
    team_id: str | None = None,
) -> PromptPack:
    """Import a prompt pack from a ZIP file containing manifest.json + .md files."""
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        # Look for manifest
        manifest = {}
        manifest_path = None
        for name in zf.namelist():
            if name.endswith("manifest.json"):
                manifest = json.loads(zf.read(name).decode("utf-8"))
                manifest_path = name
                break

        # Create pack
        pack = PromptPack(
            name=pack_name,
            version=manifest.get("version", "1.0.0"),
            description=manifest.get("description", ""),
            team_id=team_id,
            manifest=manifest,
        )
        db.add(pack)
        await db.flush()

        # Determine base directory from manifest location
        base_dir = ""
        if manifest_path and "/" in manifest_path:
            base_dir = manifest_path.rsplit("/", 1)[0] + "/"

        # Load markdown files
        md_files = [n for n in zf.namelist() if n.endswith(".md")]

        for md_path in sorted(md_files):
            content = zf.read(md_path).decode("utf-8")
            filename = md_path.replace(base_dir, "")

            metadata, body = parse_frontmatter(content)

            # Determine layer from manifest or filename
            layer = _determine_layer(filename, manifest)

            # Extract sort order from filename (e.g., 00_, 17_)
            sort_match = re.match(r"(\d+)", filename.split("/")[-1])
            sort_order = int(sort_match.group(1)) if sort_match else 99

            module = PromptModule(
                pack_id=pack.id,
                filename=filename,
                title=metadata.get("title", filename.replace("_", " ").replace(".md", "")),
                layer=layer,
                tags=metadata.get("use_when", metadata.get("tags", [])),
                priority=metadata.get("priority", 50 if layer == "domain" else 100),
                content=body if body else content,
                token_count=count_tokens_approx(body if body else content),
                max_tokens=metadata.get("max_chars"),
                sort_order=sort_order,
            )
            db.add(module)

        # Import modes if present in manifest
        for mode_def in manifest.get("modes", []):
            mode = TaskMode(
                pack_id=pack.id,
                name=mode_def["name"],
                prompt_text=mode_def.get("prompt_text", ""),
                form_schema=mode_def.get("form_schema"),
                sort_order=mode_def.get("sort_order", 0),
            )
            db.add(mode)

        await db.commit()
        await db.refresh(pack)
        return pack


def _determine_layer(filename: str, manifest: dict) -> str:
    """Determine module layer from manifest config or filename convention."""
    core_files = manifest.get("core", [])
    always_files = manifest.get("always_append", [])
    domain_sections = manifest.get("domains", {})

    clean_name = filename.split("/")[-1]

    if clean_name in core_files:
        return "core"
    if clean_name in always_files:
        return "always"
    for domain_files in domain_sections.values():
        if clean_name in domain_files:
            return "domain"

    # Fallback: files 00-15 are core, 16 is always, 17+ are domain
    sort_match = re.match(r"(\d+)", clean_name)
    if sort_match:
        num = int(sort_match.group(1))
        if num <= 15:
            return "core"
        if num == 16:
            return "always"
        return "domain"

    return "core"
```

- [ ] **Step 2: Create admin routes**

Write `promptbase/backend/app/admin/routes.py`:

```python
import io
import json
import uuid
import zipfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.importer import import_pack_from_zip
from app.auth.dependencies import get_current_user
from app.auth.models import Team, User
from app.auth.service import get_user_team_role
from app.compiler.budget import count_tokens_approx
from app.compiler.models import PromptModule, PromptPack, TaskMode
from app.compiler.schemas import (
    PromptModuleCreate,
    PromptModuleResponse,
    PromptPackCreate,
    PromptPackResponse,
    TaskModeCreate,
    TaskModeResponse,
)
from app.database import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


# --- Prompt Packs ---

@router.get("/packs", response_model=list[PromptPackResponse])
async def list_packs(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PromptPack).order_by(PromptPack.created_at.desc()))
    packs = result.scalars().all()
    return [
        PromptPackResponse(
            id=p.id, name=p.name, version=p.version, description=p.description,
            team_id=p.team_id, created_at=p.created_at.isoformat(),
        )
        for p in packs
    ]


@router.post("/packs", response_model=PromptPackResponse, status_code=status.HTTP_201_CREATED)
async def create_pack(
    body: PromptPackCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pack = PromptPack(name=body.name, version=body.version, description=body.description)
    db.add(pack)
    await db.commit()
    await db.refresh(pack)
    return PromptPackResponse(
        id=pack.id, name=pack.name, version=pack.version,
        description=pack.description, team_id=pack.team_id,
        created_at=pack.created_at.isoformat(),
    )


@router.post("/packs/import")
async def import_pack(
    file: UploadFile,
    name: str = "Imported Pack",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")

    contents = await file.read()
    pack = await import_pack_from_zip(db, contents, name)
    return {"id": str(pack.id), "name": pack.name, "version": pack.version}


@router.get("/packs/{pack_id}/export")
async def export_pack(
    pack_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pack_result = await db.execute(select(PromptPack).where(PromptPack.id == pack_id))
    pack = pack_result.scalar_one_or_none()
    if not pack:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    modules_result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack_id).order_by(PromptModule.sort_order)
    )
    modules = modules_result.scalars().all()

    modes_result = await db.execute(select(TaskMode).where(TaskMode.pack_id == pack_id))
    modes = modes_result.scalars().all()

    # Build ZIP
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "version": pack.version,
            "description": pack.description,
            "core": [m.filename for m in modules if m.layer == "core"],
            "always_append": [m.filename for m in modules if m.layer == "always"],
            "domains": {},
            "modes": [{"name": m.name, "prompt_text": m.prompt_text, "form_schema": m.form_schema} for m in modes],
        }

        for m in modules:
            if m.layer == "domain":
                key = m.filename.replace(".md", "").lower()
                manifest["domains"][key] = [m.filename]

            # Write .md with frontmatter
            frontmatter = f"""---
title: {m.title}
tags: {json.dumps(m.tags or [])}
priority: {m.priority}
layer: {m.layer}
---

"""
            zf.writestr(f"prompts/{m.filename}", frontmatter + m.content)

        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={pack.name}.zip"},
    )


# --- Modules ---

@router.get("/packs/{pack_id}/modules", response_model=list[PromptModuleResponse])
async def list_modules(
    pack_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PromptModule).where(PromptModule.pack_id == pack_id).order_by(PromptModule.sort_order)
    )
    return result.scalars().all()


@router.post("/packs/{pack_id}/modules", response_model=PromptModuleResponse, status_code=status.HTTP_201_CREATED)
async def create_module(
    pack_id: uuid.UUID,
    body: PromptModuleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    module = PromptModule(
        pack_id=pack_id,
        filename=body.filename,
        title=body.title,
        layer=body.layer,
        tags=body.tags,
        priority=body.priority,
        content=body.content,
        token_count=count_tokens_approx(body.content),
        max_tokens=body.max_tokens,
        sort_order=body.sort_order,
    )
    db.add(module)
    await db.commit()
    await db.refresh(module)
    return module


@router.put("/modules/{module_id}", response_model=PromptModuleResponse)
async def update_module(
    module_id: uuid.UUID,
    body: PromptModuleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PromptModule).where(PromptModule.id == module_id))
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    module.filename = body.filename
    module.title = body.title
    module.layer = body.layer
    module.tags = body.tags
    module.priority = body.priority
    module.content = body.content
    module.token_count = count_tokens_approx(body.content)
    module.max_tokens = body.max_tokens
    module.sort_order = body.sort_order

    await db.commit()
    await db.refresh(module)
    return module


@router.delete("/modules/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_module(
    module_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PromptModule).where(PromptModule.id == module_id))
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    await db.delete(module)
    await db.commit()


# --- Task Modes ---

@router.get("/packs/{pack_id}/modes", response_model=list[TaskModeResponse])
async def list_modes(
    pack_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TaskMode).where(TaskMode.pack_id == pack_id).order_by(TaskMode.sort_order)
    )
    return result.scalars().all()


@router.post("/packs/{pack_id}/modes", response_model=TaskModeResponse, status_code=status.HTTP_201_CREATED)
async def create_mode(
    pack_id: uuid.UUID,
    body: TaskModeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    mode = TaskMode(
        pack_id=pack_id,
        name=body.name,
        prompt_text=body.prompt_text,
        form_schema=body.form_schema,
        sort_order=body.sort_order,
    )
    db.add(mode)
    await db.commit()
    await db.refresh(mode)
    return mode


# --- Team Config ---

@router.put("/teams/{team_id}/pack")
async def assign_pack_to_team(
    team_id: uuid.UUID,
    pack_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role != "admin" and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    team.pack_id = pack_id
    await db.commit()
    return {"team_id": str(team_id), "pack_id": str(pack_id)}
```

- [ ] **Step 3: Register admin router in main.py**

In `promptbase/backend/app/main.py`, add:

```python
from app.admin.routes import router as admin_router

app.include_router(admin_router)
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: admin routes for pack CRUD, import/export, module management"
```

---

## Phase 9: Integration & Final Wiring

### Task 21: Final main.py & LLM Config Tables

**Files:**
- Modify: `promptbase/backend/app/main.py`
- Create: `promptbase/backend/app/providers/models.py`

- [ ] **Step 1: Create provider config models**

Write `promptbase/backend/app/providers/models.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LLMProviderConfig(Base):
    __tablename__ = "llm_providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)  # anthropic, openai, openrouter, ollama
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class TeamLLMConfig(Base):
    __tablename__ = "team_llm_config"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), unique=True)
    provider_name: Mapped[str] = mapped_column(String(50))
    chat_model: Mapped[str] = mapped_column(String(100))
    embedding_model: Mapped[str] = mapped_column(String(100), default="text-embedding-3-small")
    max_tokens_per_request: Mapped[int] = mapped_column(Integer, default=4096)
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
```

- [ ] **Step 2: Generate migration for provider tables**

Add to `promptbase/backend/alembic/env.py`:

```python
from app.providers.models import LLMProviderConfig, TeamLLMConfig  # noqa: F401
```

```bash
cd promptbase/backend
alembic revision --autogenerate -m "provider config tables"
alembic upgrade head
```

- [ ] **Step 3: Finalize main.py with all routers**

Write the complete `promptbase/backend/app/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown


app = FastAPI(title="PromptBase", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
from app.auth.routes import router as auth_router
from app.chat.routes import router as chat_router
from app.documents.routes import router as documents_router
from app.export.routes import router as export_router
from app.admin.routes import router as admin_router

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(documents_router)
app.include_router(export_router)
app.include_router(admin_router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: provider config models and finalized main.py with all routers"
```

---

### Task 22: Run Full Test Suite & Verify Docker

- [ ] **Step 1: Run all tests**

```bash
cd promptbase/backend
pytest tests/ -v
```

Expected: All tests pass.

- [ ] **Step 2: Rebuild and verify Docker**

```bash
cd promptbase
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up -d --build
```

- [ ] **Step 3: Test health endpoint**

```bash
curl http://localhost:8000/api/health
```

Expected: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 4: Check API docs**

Open `http://localhost:8000/docs` — all routes should be listed in the Swagger UI.

- [ ] **Step 5: Commit final state**

```bash
git add .
git commit -m "chore: verify full test suite and Docker deployment"
```

---

## Summary

| Phase | Tasks | What it builds |
|-------|-------|---------------|
| 1. Foundation | 1-3 | Project scaffold, Docker, DB, Celery |
| 2. Auth | 4-6 | Users, teams, JWT, invites |
| 3. Compiler | 7-10 | Prompt pack models, classifier, budget, compiler |
| 4. Providers | 11 | Anthropic, OpenAI, OpenRouter, Ollama |
| 5. Documents | 12-15 | Parser, chunker, retriever, worker, routes |
| 6. Chat | 16-17 | Conversations, messages, SSE streaming |
| 7. Export | 18-19 | MD → DOCX renderer, export routes |
| 8. Admin | 20 | Pack CRUD, import/export, team config |
| 9. Integration | 21-22 | Provider config, final wiring, verification |

**Next:** Frontend implementation plan (React + Vite + Tailwind) as a separate plan document.
